// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {FullMath, OracleMath} from "./lib/UniswapV3Math.sol";

interface IERC20Like {
    function balanceOf(address) external view returns (uint256);
}

interface ISwapRouter02 {
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut);
}

interface IUniswapV3FactoryLike {
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address);
}

interface IUniswapV3PoolLike {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external view returns (uint24);
    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s);
}

/// @title ArbolitoGuard (v2, MiniPay-native)
/// @notice Lets Arbolito act autonomously for a plain EOA (a MiniPay wallet) within limits that
///         only that EOA can set. Payday splits, scheduled sends and price triggers run through
///         here. Anything the user starts (convert, send, Textile fills) the user's own wallet
///         signs and sends, not this contract.
///
///         Onboarding, all sent by the user's EOA (`account`), gas paid in stablecoins:
///           1. `token.approve(guard, bounded)`: the hard ceiling on what the guard can ever move.
///           2. `configure(...)`: per-token per-tx and per-day caps, saved contacts, max slippage,
///              optional price references.
///           3. `setOperator(arbolito, expiry)`: one operator per account, and it expires.
///
///         - One shared instance. Ownerless, immutable, non-upgradeable. It holds no funds between calls.
///         - Configuration changes only when `msg.sender == account`, so there is no signature
///           scheme to get wrong. The operator can never configure; it may only `pause` the account.
///         - A never-configured account is fully blocked. Caps are per account, in UTC-day buckets.
///
/// @dev Security argument: what a compromised operator key can and can't do.
///      It CAN, for each account that named it (until expiry or revocation):
///        - swap that account's allowlisted tokens through the pinned pools, within its per-tx and
///          per-day caps, at a minOut no lower than the floor. The floor is the TWAP or the
///          account's own price reference, whichever is stricter, less the account's
///          maxSlippageBps (<= 10%). Output always goes to the account. The worst case is losing
///          up to maxSlippageBps plus pool fees per swap (e.g. by sandwiching its own swaps),
///          bounded by the day cap.
///        - pay the account's saved contacts, within the same caps.
///        - pause the account (griefing only).
///      It CAN'T:
///        - pay anyone else. `sendFor` needs a saved contact. `swapFor` hard-codes
///          `recipient = account`, and the post-swap balance checks confirm it.
///        - change configuration or unpause. `configure` requires msg.sender == account.
///        - set, extend or hand over the operator role. Only the account can.
///        - exceed the ERC-20 allowance the account gave the guard. That is the token's own check.
///        - act for another account (it must be that account's named operator), or use a token
///          or pool outside the immutable allowlist, or a path longer than MAX_HOPS.
///        - make the guard keep anything. Approvals go back to 0 and balance deltas are checked.
///
///      Not covered: the account key itself. Whoever controls the EOA (including any EIP-7702
///      delegate code installed on it) is the account and can do everything above and more.
///
///      Why there is no Textile path: Textile firm quotes are taker-exclusive onchain. The
///      maker's order names the taker as the only allowed filler (UniswapX
///      additionalValidationContract), so the reactor rejects any other `msg.sender`. A quote
///      bound to the user's EOA can only be filled by that EOA, so the guard can never fill it.
///      Pointing the guard at the reactor would also let a hostile order make the account pay
///      its outputs. Users fill Textile quotes from their own wallet; autonomous rules use
///      Uniswap only. (v1's `fillTextile` is removed; see docs/04-reference.md.)
contract ArbolitoGuard {
    // ---------------------------------------------------------------- config types
    struct TokenLimit {
        address token;
        uint128 maxPerTx; // atomic units of `token`
        uint128 maxPerDay; // atomic units, per UTC day
    }

    struct Recipient {
        address recipient;
        bool allowed;
    }

    /// @dev Account-set price for one direction: `amountIn` of tokenIn is worth at least
    ///      `amountOut` of tokenOut until `expiry`. `amountOut == 0` clears it.
    struct PriceRef {
        address tokenIn;
        address tokenOut;
        uint128 amountIn;
        uint128 amountOut;
        uint64 expiry;
    }

    /// @dev `account` must be msg.sender. That stops an integrator who signs from the wrong wallet
    ///      from silently configuring that wallet instead. `paused` and `maxSlippageBps` are
    ///      always written. The arrays are deltas.
    struct Config {
        address account;
        bool paused;
        uint16 maxSlippageBps;
        TokenLimit[] limits;
        Recipient[] recipients;
        PriceRef[] prices;
    }

    // ---------------------------------------------------------------- storage types
    struct Limit {
        uint128 maxPerTx;
        uint128 maxPerDay;
    }

    struct Spend {
        uint64 day; // block.timestamp / 1 days
        uint192 spent;
    }

    struct Settings {
        bool configured;
        bool paused;
        uint16 maxSlippageBps;
    }

    struct Operator {
        address operator;
        uint64 expiry;
    }

    struct Ref {
        uint128 amountIn;
        uint128 amountOut;
        uint64 expiry;
    }

    // ---------------------------------------------------------------- constants
    /// @notice Upper bound for maxSlippageBps (10%). No "floor = 0" footgun.
    uint16 public constant MAX_SLIPPAGE_BPS = 1000;
    uint256 public constant MAX_HOPS = 3;

    // ---------------------------------------------------------------- immutables
    address public immutable swapRouter;
    address public immutable factory;
    /// @notice TWAP window in seconds for the price floor.
    uint32 public immutable twapWindow;

    // ---------------------------------------------------------------- state
    /// @notice Immutable after construction (no setter).
    mapping(address token => bool) public isAllowedToken;
    /// @notice Immutable after construction. True for every pinned pool.
    mapping(address pool => bool) public isPinnedPool;
    /// @dev keccak256(token0, token1, fee) => pool. Immutable after construction, checked against the factory.
    mapping(bytes32 key => address pool) private _pools;

    mapping(address account => Settings) private _settings;
    mapping(address account => Operator) private _operators;
    mapping(address account => mapping(address token => Limit)) private _limits;
    mapping(address account => mapping(address token => Spend)) private _spends;
    mapping(address account => mapping(address recipient => bool)) public isRecipient;
    mapping(address account => mapping(address tokenIn => mapping(address tokenOut => Ref))) private _refs;

    // ---------------------------------------------------------------- events
    event OperatorSet(address indexed account, address indexed operator, uint64 expiry);
    event OperatorRevoked(address indexed account, address indexed operator);
    event Configured(address indexed account);
    event SettingsSet(address indexed account, bool paused, uint16 maxSlippageBps);
    event TokenLimitSet(address indexed account, address indexed token, uint128 maxPerTx, uint128 maxPerDay);
    event RecipientSet(address indexed account, address indexed recipient, bool allowed);
    event PriceRefSet(
        address indexed account,
        address indexed tokenIn,
        address indexed tokenOut,
        uint128 amountIn,
        uint128 amountOut,
        uint64 expiry
    );
    event Paused(address indexed account, address indexed by);
    event Swapped(
        address indexed account,
        address indexed tokenIn,
        address indexed tokenOut,
        address by,
        uint256 amountIn,
        uint256 amountOut,
        uint256 minOut,
        uint256 floor
    );
    event Sent(address indexed account, address indexed token, address indexed to, address by, uint256 amount);

    // ---------------------------------------------------------------- errors
    error ZeroAddress();
    error PoolMismatch(address pool);
    error TokenNotAllowed(address token);
    error PoolNotAllowed(address tokenA, address tokenB, uint24 fee);
    error BadPath();
    error NotAccount(address caller, address account);
    error NotOperator(address caller, address account);
    error BadOperator(address operator);
    error BadExpiry(uint64 expiry);
    error NotConfigured(address account);
    error AccountPaused(address account);
    error NotRecipient(address recipient);
    error BadRecipient(address recipient);
    error ExceedsTxCap(address token, uint256 amount, uint256 cap);
    error ExceedsDayCap(address token, uint256 spentToday, uint256 cap);
    error ZeroAmount();
    error MinOutBelowFloor(uint256 minOut, uint256 floor);
    error NoPriceReference(address tokenIn, address tokenOut);
    error SlippageTooHigh(uint16 bps);
    error BadPriceRef();
    error TransferFailed(address token);
    error Reentrancy();
    error UnexpectedBalance(address token);

    // ---------------------------------------------------------------- construction
    /// @param pools Uniswap v3 pools a swap may route through. Each must be the factory's pool for
    ///        its (token0, token1, fee) and join two allowlisted tokens.
    constructor(
        address swapRouter_,
        address factory_,
        uint32 twapWindow_,
        address[] memory tokens,
        address[] memory pools
    ) {
        if (swapRouter_ == address(0) || factory_ == address(0)) revert ZeroAddress();
        require(twapWindow_ > 0);
        swapRouter = swapRouter_;
        factory = factory_;
        twapWindow = twapWindow_;
        for (uint256 i; i < tokens.length; i++) {
            if (tokens[i] == address(0)) revert ZeroAddress();
            isAllowedToken[tokens[i]] = true;
        }
        for (uint256 i; i < pools.length; i++) {
            IUniswapV3PoolLike p = IUniswapV3PoolLike(pools[i]);
            (address t0, address t1, uint24 fee) = (p.token0(), p.token1(), p.fee());
            if (!isAllowedToken[t0]) revert TokenNotAllowed(t0);
            if (!isAllowedToken[t1]) revert TokenNotAllowed(t1);
            if (IUniswapV3FactoryLike(factory_).getPool(t0, t1, fee) != pools[i]) revert PoolMismatch(pools[i]);
            _pools[_poolKey(t0, t1, fee)] = pools[i];
            isPinnedPool[pools[i]] = true;
        }
    }

    /// @dev Transient-storage lock (EIP-1153, live on Celo).
    modifier nonReentrant() {
        bool locked;
        assembly ("memory-safe") {
            locked := tload(0)
        }
        if (locked) revert Reentrancy();
        assembly ("memory-safe") {
            tstore(0, 1)
        }
        _;
        assembly ("memory-safe") {
            tstore(0, 0)
        }
    }

    /// @dev The account itself, or its operator while it hasn't expired.
    modifier onlyAccountOrOperator(address account) {
        if (msg.sender != account && !isActiveOperator(account, msg.sender)) revert NotOperator(msg.sender, account);
        _;
    }

    // ================================================================ account-only: operator + config
    /// @notice Name the one address that may act for msg.sender until `expiry` (unix seconds).
    ///         Replaces any previous operator.
    function setOperator(address operator, uint64 expiry) external {
        if (operator == address(0) || operator == address(this) || operator == msg.sender) revert BadOperator(operator);
        if (expiry <= block.timestamp) revert BadExpiry(expiry);
        _operators[msg.sender] = Operator(operator, expiry);
        emit OperatorSet(msg.sender, operator, expiry);
    }

    /// @notice Remove msg.sender's operator. Idempotent, so an emergency revoke never fails.
    function revokeOperator() external {
        address prev = _operators[msg.sender].operator;
        delete _operators[msg.sender];
        emit OperatorRevoked(msg.sender, prev);
    }

    /// @notice Set msg.sender's limits. Only the account can call this, never its operator.
    ///         Passing `paused = false` is the only way to unpause.
    function configure(Config calldata c) external {
        address account = msg.sender;
        if (c.account != account) revert NotAccount(account, c.account);
        if (c.maxSlippageBps > MAX_SLIPPAGE_BPS) revert SlippageTooHigh(c.maxSlippageBps);

        _settings[account] = Settings({configured: true, paused: c.paused, maxSlippageBps: c.maxSlippageBps});
        emit SettingsSet(account, c.paused, c.maxSlippageBps);

        for (uint256 i; i < c.limits.length; i++) {
            TokenLimit calldata l = c.limits[i];
            if (!isAllowedToken[l.token]) revert TokenNotAllowed(l.token);
            _limits[account][l.token] = Limit(l.maxPerTx, l.maxPerDay);
            emit TokenLimitSet(account, l.token, l.maxPerTx, l.maxPerDay);
        }
        for (uint256 i; i < c.recipients.length; i++) {
            Recipient calldata r = c.recipients[i];
            address to = r.recipient;
            // Tokens sent to the guard, the router, a token contract or a pinned pool are lost or
            // sweepable by anyone. Never accept one of those as a "contact".
            if (to == address(0) || to == address(this) || to == swapRouter || isAllowedToken[to] || isPinnedPool[to]) {
                revert BadRecipient(to);
            }
            isRecipient[account][to] = r.allowed;
            emit RecipientSet(account, to, r.allowed);
        }
        for (uint256 i; i < c.prices.length; i++) {
            PriceRef calldata p = c.prices[i];
            if (!isAllowedToken[p.tokenIn]) revert TokenNotAllowed(p.tokenIn);
            if (!isAllowedToken[p.tokenOut]) revert TokenNotAllowed(p.tokenOut);
            if (p.tokenIn == p.tokenOut || (p.amountOut != 0 && p.amountIn == 0)) revert BadPriceRef();
            _refs[account][p.tokenIn][p.tokenOut] = Ref(p.amountIn, p.amountOut, p.expiry);
            emit PriceRefSet(account, p.tokenIn, p.tokenOut, p.amountIn, p.amountOut, p.expiry);
        }
        emit Configured(account);
    }

    // ================================================================ account or operator
    /// @notice Pause `account`. Its active operator may do this too (it can only make things
    ///         weaker). Only the account can unpause, via `configure`.
    function pause(address account) external onlyAccountOrOperator(account) {
        _settings[account].paused = true;
        emit Paused(account, msg.sender);
    }

    /// @notice Swap `amountIn` of the path's first token for its last token, paid to `account`.
    /// @param path Uniswap v3 packed path: token (20) | fee (3) | token (20) ...
    /// @param minOut Must be >= the floor: TWAP or price ref (stricter), less maxSlippageBps.
    function swapFor(address account, bytes calldata path, uint256 amountIn, uint256 minOut)
        external
        nonReentrant
        onlyAccountOrOperator(account)
        returns (uint256 amountOut)
    {
        _checkActive(account);
        (address tokenIn, address tokenOut, uint256 floor) = _checkPathAndFloor(account, path, amountIn);
        if (minOut < floor) revert MinOutBelowFloor(minOut, floor);
        _checkCaps(account, tokenIn, amountIn);
        _record(account, tokenIn, amountIn);
        amountOut = _routeSwap(account, path, tokenIn, tokenOut, amountIn, minOut);
        emit Swapped(account, tokenIn, tokenOut, msg.sender, amountIn, amountOut, minOut, floor);
    }

    /// @dev Pull exactly amountIn, approve exactly that, swap with recipient = account, reset the
    ///      approval, then check the balance deltas.
    function _routeSwap(
        address account,
        bytes calldata path,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minOut
    ) private returns (uint256 amountOut) {
        uint256 heldBefore = IERC20Like(tokenIn).balanceOf(address(this));
        uint256 outBefore = IERC20Like(tokenOut).balanceOf(account);
        _transferFrom(tokenIn, account, address(this), amountIn);
        _approve(tokenIn, swapRouter, amountIn);
        amountOut = ISwapRouter02(swapRouter).exactInput(
            ISwapRouter02.ExactInputParams({path: path, recipient: account, amountIn: amountIn, amountOutMinimum: minOut})
        );
        _approve(tokenIn, swapRouter, 0);
        // Defence in depth: the router consumed exactly amountIn and the account got >= minOut.
        if (IERC20Like(tokenIn).balanceOf(address(this)) != heldBefore) revert UnexpectedBalance(tokenIn);
        if (IERC20Like(tokenOut).balanceOf(account) < outBefore + minOut) revert UnexpectedBalance(tokenOut);
    }

    /// @notice Pay `amount` of `token` from `account` to one of its saved contacts.
    function sendFor(address account, address token, address to, uint256 amount)
        external
        nonReentrant
        onlyAccountOrOperator(account)
    {
        _checkActive(account);
        if (!isAllowedToken[token]) revert TokenNotAllowed(token);
        if (!isRecipient[account][to]) revert NotRecipient(to);
        _checkCaps(account, token, amount);
        _record(account, token, amount);
        _transferFrom(token, account, to, amount);
        emit Sent(account, token, to, msg.sender, amount);
    }

    // ================================================================ views
    function isActiveOperator(address account, address who) public view returns (bool) {
        Operator memory o = _operators[account];
        return who != address(0) && o.operator == who && block.timestamp < o.expiry;
    }

    /// @return operator The named operator (it may have expired).
    /// @return expiry Unix seconds. The operator is active while block.timestamp < expiry.
    /// @return active Whether it can act right now.
    function operatorOf(address account) external view returns (address operator, uint64 expiry, bool active) {
        Operator memory o = _operators[account];
        return (o.operator, o.expiry, o.operator != address(0) && block.timestamp < o.expiry);
    }

    function settings(address account) external view returns (bool configured, bool paused, uint16 maxSlippageBps) {
        Settings memory s = _settings[account];
        return (s.configured, s.paused, s.maxSlippageBps);
    }

    function limits(address account, address token) external view returns (uint128 maxPerTx, uint128 maxPerDay) {
        Limit memory l = _limits[account][token];
        return (l.maxPerTx, l.maxPerDay);
    }

    /// @notice Amount of `token` already spent in the current UTC day.
    function spentToday(address account, address token) public view returns (uint256) {
        Spend memory sp = _spends[account][token];
        return sp.day == block.timestamp / 1 days ? sp.spent : 0;
    }

    function priceRef(address account, address tokenIn, address tokenOut)
        external
        view
        returns (uint128 amountIn, uint128 amountOut, uint64 expiry)
    {
        Ref memory r = _refs[account][tokenIn][tokenOut];
        return (r.amountIn, r.amountOut, r.expiry);
    }

    function poolFor(address tokenA, address tokenB, uint24 fee) public view returns (address) {
        return tokenA < tokenB ? _pools[_poolKey(tokenA, tokenB, fee)] : _pools[_poolKey(tokenB, tokenA, fee)];
    }

    /// @notice The lowest `minOut` `account` may pass for this swap right now.
    function minOutFloor(address account, bytes calldata path, uint256 amountIn) external view returns (uint256 floor) {
        (,, floor) = _checkPathAndFloor(account, path, amountIn);
    }

    /// @notice TWAP-implied output of one pool hop. ok = false when the pool's oracle can't cover the window.
    function twapQuote(address pool, address tokenIn, address tokenOut, uint256 amountIn)
        public
        view
        returns (bool ok, uint256 amountOut)
    {
        if (amountIn > type(uint128).max) return (false, 0);
        uint32[] memory ago = new uint32[](2);
        ago[0] = twapWindow;
        try IUniswapV3PoolLike(pool).observe(ago) returns (int56[] memory tc, uint160[] memory) {
            int24 tick = OracleMath.meanTick(tc[0], tc[1], twapWindow);
            // forge-lint: disable-next-line(unsafe-typecast) amountIn <= uint128 max, checked above
            return (true, OracleMath.getQuoteAtTick(tick, uint128(amountIn), tokenIn, tokenOut));
        } catch {
            return (false, 0);
        }
    }

    // ================================================================ internals
    function _checkActive(address account) internal view {
        Settings memory s = _settings[account];
        if (!s.configured) revert NotConfigured(account);
        if (s.paused) revert AccountPaused(account);
    }

    function _checkPathAndFloor(address account, bytes calldata path, uint256 amountIn)
        internal
        view
        returns (address tokenIn, address tokenOut, uint256 floor)
    {
        if (amountIn == 0) revert ZeroAmount();
        if (path.length < 43 || (path.length - 20) % 23 != 0) revert BadPath();
        uint256 hops = (path.length - 20) / 23;
        if (hops > MAX_HOPS) revert BadPath();

        tokenIn = address(bytes20(path[0:20]));
        if (!isAllowedToken[tokenIn]) revert TokenNotAllowed(tokenIn);
        tokenOut = tokenIn;
        floor = amountIn; // running fair value through the hops
        for (uint256 i; i < hops; i++) {
            (address next, address pool) = _hopAt(path, i, tokenOut);
            floor = _hopValue(account, pool, tokenOut, next, floor);
            tokenOut = next;
        }
        if (tokenOut == tokenIn) revert BadPath();
        floor = floor * (10_000 - _settings[account].maxSlippageBps) / 10_000;
    }

    /// @dev Hop `i` of a packed path starting at `from`: its output token and allowlisted pool.
    function _hopAt(bytes calldata path, uint256 i, address from) private view returns (address to, address pool) {
        uint256 o = 20 + i * 23;
        uint24 fee = uint24(bytes3(path[o:o + 3]));
        to = address(bytes20(path[o + 3:o + 23]));
        if (!isAllowedToken[to]) revert TokenNotAllowed(to);
        pool = poolFor(from, to, fee);
        if (pool == address(0)) revert PoolNotAllowed(from, to, fee);
    }

    /// @dev Fair value of one hop: the pool TWAP and/or the account's reference price,
    ///      whichever is HIGHER (stricter). Reverts if neither is available.
    function _hopValue(address account, address pool, address tokenIn, address tokenOut, uint256 amountIn)
        internal
        view
        returns (uint256 value)
    {
        bool have;
        (have, value) = twapQuote(pool, tokenIn, tokenOut, amountIn);
        Ref memory r = _refs[account][tokenIn][tokenOut];
        if (r.amountOut != 0 && block.timestamp <= r.expiry) {
            uint256 refValue = FullMath.mulDiv(amountIn, r.amountOut, r.amountIn);
            if (!have || refValue > value) value = refValue;
            have = true;
        }
        if (!have) revert NoPriceReference(tokenIn, tokenOut);
    }

    function _checkCaps(address account, address token, uint256 amount) internal view {
        if (amount == 0) revert ZeroAmount();
        Limit memory l = _limits[account][token];
        if (amount > l.maxPerTx) revert ExceedsTxCap(token, amount, l.maxPerTx);
        uint256 today = spentToday(account, token);
        if (today + amount > l.maxPerDay) revert ExceedsDayCap(token, today, l.maxPerDay);
    }

    function _record(address account, address token, uint256 amount) internal {
        uint64 day = uint64(block.timestamp / 1 days);
        Spend storage sp = _spends[account][token];
        // amount <= maxPerTx (uint128) and spent <= maxPerDay (uint128), so uint192 cannot truncate.
        if (sp.day != day) {
            sp.day = day;
            // forge-lint: disable-next-line(unsafe-typecast)
            sp.spent = uint192(amount);
        } else {
            // forge-lint: disable-next-line(unsafe-typecast)
            sp.spent += uint192(amount);
        }
    }

    function _poolKey(address token0, address token1, uint24 fee) private pure returns (bytes32) {
        return keccak256(abi.encode(token0, token1, fee));
    }

    function _transferFrom(address token, address from, address to, uint256 amount) private {
        _call(token, abi.encodeWithSignature("transferFrom(address,address,uint256)", from, to, amount));
    }

    function _approve(address token, address spender, uint256 amount) private {
        _call(token, abi.encodeWithSignature("approve(address,uint256)", spender, amount));
    }

    function _call(address token, bytes memory data) private {
        (bool ok, bytes memory ret) = token.call(data);
        if (!ok || token.code.length == 0 || (ret.length != 0 && (ret.length < 32 || abi.decode(ret, (uint256)) != 1)))
        {
            revert TransferFailed(token);
        }
    }
}
