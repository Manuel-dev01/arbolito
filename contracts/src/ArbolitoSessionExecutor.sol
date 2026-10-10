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

/// @title ArbolitoSessionExecutor
/// @notice The only call target an Arbolito session key is given on a user's thirdweb smart account.
///         thirdweb session keys are scoped by target address only, so a key aimed at SwapRouter02
///         or Textile's reactor could pick any recipient. This guard is the narrow waist instead:
///         `msg.sender` is always the user's account, every payout goes to that account or to one
///         of its admin-approved contacts, and every swap must clear a TWAP-based price floor.
///
///         - One shared, ownerless, non-upgradeable instance. It holds no funds between calls.
///         - Per-account limits are set ONLY by an EIP-712 signature from an admin of the account
///           (the session key acts *as* the account, so `msg.sender == account` proves nothing).
///         - A never-configured account can do nothing: zero caps, no contacts.
///         - The account itself (i.e. the session key) may only make itself *less* powerful: `pause()`.
contract ArbolitoSessionExecutor {
    // ---------------------------------------------------------------- signed config types
    struct TokenLimit {
        address token;
        uint128 maxPerTx; // atomic units of `token`
        uint128 maxPerDay; // atomic units, per UTC day
    }

    struct Recipient {
        address recipient;
        bool allowed;
    }

    /// @dev Admin-signed price for one direction: `amountIn` of tokenIn is worth at least
    ///      `amountOut` of tokenOut until `expiry`. `amountOut == 0` clears it.
    struct PriceRef {
        address tokenIn;
        address tokenOut;
        uint128 amountIn;
        uint128 amountOut;
        uint64 expiry;
    }

    /// @dev `paused` and `maxSlippageBps` are always written; the arrays are deltas.
    struct ConfigUpdate {
        address account;
        uint256 nonce;
        uint256 deadline;
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
        bool paused;
        uint16 maxSlippageBps;
        uint64 nonce;
    }

    struct Ref {
        uint128 amountIn;
        uint128 amountOut;
        uint64 expiry;
    }

    // ---------------------------------------------------------------- constants
    bytes32 public constant TOKEN_LIMIT_TYPEHASH =
        keccak256("TokenLimit(address token,uint128 maxPerTx,uint128 maxPerDay)");
    bytes32 public constant RECIPIENT_TYPEHASH = keccak256("Recipient(address recipient,bool allowed)");
    bytes32 public constant PRICE_REF_TYPEHASH =
        keccak256("PriceRef(address tokenIn,address tokenOut,uint128 amountIn,uint128 amountOut,uint64 expiry)");
    bytes32 public constant CONFIG_UPDATE_TYPEHASH = keccak256(
        "ConfigUpdate(address account,uint256 nonce,uint256 deadline,bool paused,uint16 maxSlippageBps,TokenLimit[] limits,Recipient[] recipients,PriceRef[] prices)"
        "PriceRef(address tokenIn,address tokenOut,uint128 amountIn,uint128 amountOut,uint64 expiry)"
        "Recipient(address recipient,bool allowed)"
        "TokenLimit(address token,uint128 maxPerTx,uint128 maxPerDay)"
    );
    bytes32 private constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    bytes32 private constant NAME_HASH = keccak256("ArbolitoSessionExecutor");
    bytes32 private constant VERSION_HASH = keccak256("1");
    uint256 private constant HALF_N = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    /// @notice Upper bound an admin may sign for maxSlippageBps (10%): no "floor = 0" footgun.
    uint16 public constant MAX_SLIPPAGE_BPS = 1000;
    uint256 public constant MAX_HOPS = 3;
    bytes4 private constant EXECUTE_SELECTOR = bytes4(keccak256("execute((bytes,bytes))"));
    bytes4 private constant EXECUTE_BATCH_SELECTOR = bytes4(keccak256("executeBatch((bytes,bytes)[])"));

    // ---------------------------------------------------------------- immutables
    address public immutable swapRouter;
    address public immutable factory;
    /// @notice Textile's LimitOrderReactor (UniswapX). address(0) disables `fillTextile`.
    address public immutable reactor;
    /// @notice TWAP window in seconds for the price floor.
    uint32 public immutable twapWindow;
    uint256 private immutable INITIAL_CHAIN_ID;
    bytes32 private immutable INITIAL_DOMAIN_SEPARATOR;

    // ---------------------------------------------------------------- state
    /// @notice Immutable after construction (no setter).
    mapping(address token => bool) public isAllowedToken;
    /// @dev keccak256(token0, token1, fee) => pool; immutable after construction, checked against the factory.
    mapping(bytes32 key => address pool) private _pools;

    mapping(address account => Settings) private _settings;
    mapping(address account => mapping(address token => Limit)) private _limits;
    mapping(address account => mapping(address token => Spend)) private _spends;
    mapping(address account => mapping(address recipient => bool)) public isRecipient;
    mapping(address account => mapping(address tokenIn => mapping(address tokenOut => Ref))) private _refs;

    // ---------------------------------------------------------------- events
    event Swapped(
        address indexed account,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 minOut,
        uint256 floor
    );
    event Sent(address indexed account, address indexed token, address indexed to, uint256 amount);
    event TextileFilled(
        address indexed account,
        address indexed sellToken,
        address indexed buyToken,
        uint256 sold,
        uint256 bought,
        uint256 floor
    );
    event ConfigApplied(address indexed account, address indexed admin, uint256 nonce);
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
    event SettingsSet(address indexed account, bool paused, uint16 maxSlippageBps);
    event Paused(address indexed account);

    // ---------------------------------------------------------------- errors
    error ZeroAddress();
    error PoolMismatch(address pool);
    error TokenNotAllowed(address token);
    error PoolNotAllowed(address tokenA, address tokenB, uint24 fee);
    error BadPath();
    error AccountPaused(address account);
    error NotRecipient(address recipient);
    error ExceedsTxCap(address token, uint256 amount, uint256 cap);
    error ExceedsDayCap(address token, uint256 spentToday, uint256 cap);
    error ZeroAmount();
    error MinOutBelowFloor(uint256 minOut, uint256 floor);
    error NoPriceReference(address tokenIn, address tokenOut);
    error ExpiredSignature();
    error BadNonce(uint256 expected, uint256 got);
    error BadSignature();
    error NotAdmin(address signer);
    error SlippageTooHigh(uint16 bps);
    error BadPriceRef();
    error TransferFailed(address token);
    error Reentrancy();
    error UnexpectedBalance(address token);
    error TextileDisabled();
    error BadReactorCall();
    error ReactorCallFailed(bytes reason);
    error BoughtBelowMin(uint256 bought, uint256 minBought);

    // ---------------------------------------------------------------- construction
    /// @param pools Uniswap v3 pools a swap may route through; each must be the factory's pool for
    ///        its (token0, token1, fee) and join two allowlisted tokens.
    constructor(
        address swapRouter_,
        address factory_,
        address reactor_,
        uint32 twapWindow_,
        address[] memory tokens,
        address[] memory pools
    ) {
        if (swapRouter_ == address(0) || factory_ == address(0)) revert ZeroAddress();
        require(twapWindow_ > 0);
        swapRouter = swapRouter_;
        factory = factory_;
        reactor = reactor_;
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
        }
        INITIAL_CHAIN_ID = block.chainid;
        INITIAL_DOMAIN_SEPARATOR = _buildDomainSeparator();
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

    // ================================================================ session-key actions
    /// @notice Swap `amountIn` of the path's first token for its last token, paid to msg.sender.
    /// @param path Uniswap v3 packed path: token (20) | fee (3) | token (20) ...
    /// @param minOut Must be >= the TWAP-implied output less the account's maxSlippageBps.
    function swapExactInput(bytes calldata path, uint256 amountIn, uint256 minOut)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        address account = msg.sender;
        (address tokenIn, address tokenOut, uint256 floor) = _checkPathAndFloor(account, path, amountIn);
        if (minOut < floor) revert MinOutBelowFloor(minOut, floor);
        _spend(account, tokenIn, amountIn);

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

        emit Swapped(account, tokenIn, tokenOut, amountIn, amountOut, minOut, floor);
    }

    /// @notice Pay `amount` of `token` from msg.sender to one of its admin-approved contacts.
    function send(address token, address to, uint256 amount) external nonReentrant {
        address account = msg.sender;
        if (!isAllowedToken[token]) revert TokenNotAllowed(token);
        if (!isRecipient[account][to]) revert NotRecipient(to);
        _spend(account, token, amount);
        _transferFrom(token, account, to, amount);
        emit Sent(account, token, to, amount);
    }

    /// @notice Settle a Textile RFQ fill with msg.sender's funds, the guard acting as filler.
    ///         Order contents are not trusted: the guard lends the reactor at most `maxSell` of
    ///         `sellToken`, measures what actually left and what `buyToken` actually arrived, refunds
    ///         the rest, forwards everything bought to msg.sender, and requires the realised price to
    ///         clear the same floor as a swap.
    /// @param reactorCall Calldata for the reactor: `execute` or `executeBatch` only.
    function fillTextile(
        address sellToken,
        uint256 maxSell,
        address buyToken,
        uint256 minBought,
        bytes calldata reactorCall
    ) external nonReentrant returns (uint256 sold, uint256 bought) {
        if (reactor == address(0)) revert TextileDisabled();
        address account = msg.sender;
        if (!isAllowedToken[sellToken]) revert TokenNotAllowed(sellToken);
        if (!isAllowedToken[buyToken]) revert TokenNotAllowed(buyToken);
        if (sellToken == buyToken) revert BadPath();
        if (reactorCall.length < 4) revert BadReactorCall();
        bytes4 sel = bytes4(reactorCall[:4]);
        if (sel != EXECUTE_SELECTOR && sel != EXECUTE_BATCH_SELECTOR) revert BadReactorCall();
        if (_settings[account].paused) revert AccountPaused(account);
        _checkCaps(account, sellToken, maxSell);

        uint256 leftover;
        (sold, leftover, bought) = _runReactor(account, sellToken, maxSell, buyToken, reactorCall);
        if (sold == 0) revert ZeroAmount();
        if (bought < minBought) revert BoughtBelowMin(bought, minBought);
        uint256 floor = _floorFor(account, sellToken, buyToken, sold);
        if (bought < floor) revert MinOutBelowFloor(bought, floor);
        _record(account, sellToken, sold);

        if (leftover > 0) _transfer(sellToken, account, leftover);
        _transfer(buyToken, account, bought);
        emit TextileFilled(account, sellToken, buyToken, sold, bought, floor);
    }

    /// @dev Lends the reactor `maxSell`, calls it, and measures net flows by balance deltas.
    function _runReactor(address account, address sellToken, uint256 maxSell, address buyToken, bytes calldata data)
        private
        returns (uint256 sold, uint256 leftover, uint256 bought)
    {
        uint256 sellBefore = IERC20Like(sellToken).balanceOf(address(this));
        uint256 buyBefore = IERC20Like(buyToken).balanceOf(address(this));
        _transferFrom(sellToken, account, address(this), maxSell);
        _approve(sellToken, reactor, maxSell);
        (bool ok, bytes memory ret) = reactor.call(data);
        if (!ok) revert ReactorCallFailed(ret);
        _approve(sellToken, reactor, 0);

        uint256 sellAfter = IERC20Like(sellToken).balanceOf(address(this));
        if (sellAfter < sellBefore) revert UnexpectedBalance(sellToken);
        leftover = sellAfter - sellBefore;
        if (leftover > maxSell) leftover = maxSell; // anything extra was sent in; not ours to give back
        sold = maxSell - leftover;
        bought = IERC20Like(buyToken).balanceOf(address(this)) - buyBefore;
    }

    /// @notice The account (or its session key) may always pause itself. Pausing also bumps the
    ///         config nonce, so every signed-but-unsubmitted update is void.
    function pause() external {
        Settings storage s = _settings[msg.sender];
        s.paused = true;
        unchecked {
            s.nonce++;
        }
        emit Paused(msg.sender);
    }

    // ================================================================ admin-signed config
    /// @notice Apply a config update signed (EIP-712) by an admin of `u.account`. Anyone may submit it.
    function applyConfig(ConfigUpdate calldata u, bytes calldata signature) external {
        if (block.timestamp > u.deadline) revert ExpiredSignature();
        Settings storage s = _settings[u.account];
        if (u.nonce != s.nonce) revert BadNonce(s.nonce, u.nonce);
        address signer = _recover(_hashTypedData(hashConfigUpdate(u)), signature);
        if (!_isAdmin(u.account, signer)) revert NotAdmin(signer);
        if (u.maxSlippageBps > MAX_SLIPPAGE_BPS) revert SlippageTooHigh(u.maxSlippageBps);

        unchecked {
            s.nonce++;
        }
        s.paused = u.paused;
        s.maxSlippageBps = u.maxSlippageBps;
        emit SettingsSet(u.account, u.paused, u.maxSlippageBps);

        for (uint256 i; i < u.limits.length; i++) {
            TokenLimit calldata l = u.limits[i];
            if (!isAllowedToken[l.token]) revert TokenNotAllowed(l.token);
            _limits[u.account][l.token] = Limit(l.maxPerTx, l.maxPerDay);
            emit TokenLimitSet(u.account, l.token, l.maxPerTx, l.maxPerDay);
        }
        for (uint256 i; i < u.recipients.length; i++) {
            Recipient calldata r = u.recipients[i];
            if (r.recipient == address(0) || r.recipient == address(this)) revert ZeroAddress();
            isRecipient[u.account][r.recipient] = r.allowed;
            emit RecipientSet(u.account, r.recipient, r.allowed);
        }
        for (uint256 i; i < u.prices.length; i++) {
            PriceRef calldata p = u.prices[i];
            if (!isAllowedToken[p.tokenIn]) revert TokenNotAllowed(p.tokenIn);
            if (!isAllowedToken[p.tokenOut]) revert TokenNotAllowed(p.tokenOut);
            if (p.tokenIn == p.tokenOut || (p.amountOut != 0 && p.amountIn == 0)) revert BadPriceRef();
            _refs[u.account][p.tokenIn][p.tokenOut] = Ref(p.amountIn, p.amountOut, p.expiry);
            emit PriceRefSet(u.account, p.tokenIn, p.tokenOut, p.amountIn, p.amountOut, p.expiry);
        }
        emit ConfigApplied(u.account, signer, u.nonce);
    }

    // ================================================================ views
    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return block.chainid == INITIAL_CHAIN_ID ? INITIAL_DOMAIN_SEPARATOR : _buildDomainSeparator();
    }

    function settings(address account) external view returns (bool paused, uint16 maxSlippageBps, uint256 nonce) {
        Settings memory s = _settings[account];
        return (s.paused, s.maxSlippageBps, s.nonce);
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

    /// @notice TWAP-implied output of one pool hop; ok = false when the pool's oracle can't cover the window.
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

    function hashConfigUpdate(ConfigUpdate calldata u) public pure returns (bytes32) {
        bytes32[] memory h = new bytes32[](u.limits.length);
        for (uint256 i; i < h.length; i++) {
            TokenLimit calldata l = u.limits[i];
            h[i] = keccak256(abi.encode(TOKEN_LIMIT_TYPEHASH, l.token, l.maxPerTx, l.maxPerDay));
        }
        bytes32 limitsHash = keccak256(abi.encodePacked(h));
        h = new bytes32[](u.recipients.length);
        for (uint256 i; i < h.length; i++) {
            h[i] = keccak256(abi.encode(RECIPIENT_TYPEHASH, u.recipients[i].recipient, u.recipients[i].allowed));
        }
        bytes32 recipientsHash = keccak256(abi.encodePacked(h));
        h = new bytes32[](u.prices.length);
        for (uint256 i; i < h.length; i++) {
            PriceRef calldata p = u.prices[i];
            h[i] = keccak256(abi.encode(PRICE_REF_TYPEHASH, p.tokenIn, p.tokenOut, p.amountIn, p.amountOut, p.expiry));
        }
        bytes32 pricesHash = keccak256(abi.encodePacked(h));
        return keccak256(
            abi.encode(
                CONFIG_UPDATE_TYPEHASH,
                u.account,
                u.nonce,
                u.deadline,
                u.paused,
                u.maxSlippageBps,
                limitsHash,
                recipientsHash,
                pricesHash
            )
        );
    }

    // ================================================================ internals
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
        floor = amountIn; // running TWAP value through the hops
        for (uint256 i; i < hops; i++) {
            (address next, address pool) = _hopAt(path, i, tokenOut);
            floor = _hopValue(account, pool, tokenOut, next, floor);
            tokenOut = next;
        }
        if (tokenOut == tokenIn) revert BadPath();
        floor = _applySlippage(account, floor);
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

    function _floorFor(address account, address tokenIn, address tokenOut, uint256 amountIn)
        internal
        view
        returns (uint256)
    {
        // Textile pairs are priced against the direct 0.01% pool when one is allowlisted (all of
        // ours are fee 100); pairs without one (e.g. USDC/USDT) need an admin-signed PriceRef.
        address pool = poolFor(tokenIn, tokenOut, 100);
        return _applySlippage(account, _hopValue(account, pool, tokenIn, tokenOut, amountIn));
    }

    /// @dev Fair value of one hop: the pool TWAP and/or the account's signed reference price,
    ///      whichever is HIGHER (stricter). Reverts if neither is available.
    function _hopValue(address account, address pool, address tokenIn, address tokenOut, uint256 amountIn)
        internal
        view
        returns (uint256 value)
    {
        bool have;
        if (pool != address(0)) (have, value) = twapQuote(pool, tokenIn, tokenOut, amountIn);
        Ref memory r = _refs[account][tokenIn][tokenOut];
        if (r.amountOut != 0 && block.timestamp <= r.expiry) {
            uint256 refValue = FullMath.mulDiv(amountIn, r.amountOut, r.amountIn);
            if (!have || refValue > value) value = refValue;
            have = true;
        }
        if (!have) revert NoPriceReference(tokenIn, tokenOut);
    }

    function _applySlippage(address account, uint256 value) internal view returns (uint256) {
        return value * (10_000 - _settings[account].maxSlippageBps) / 10_000;
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

    function _spend(address account, address token, uint256 amount) internal {
        if (_settings[account].paused) revert AccountPaused(account);
        _checkCaps(account, token, amount);
        _record(account, token, amount);
    }

    function _isAdmin(address account, address signer) internal view returns (bool) {
        if (account.code.length == 0) return false;
        (bool ok, bytes memory ret) = account.staticcall(abi.encodeWithSignature("isAdmin(address)", signer));
        return ok && ret.length >= 32 && abi.decode(ret, (uint256)) == 1;
    }

    function _recover(bytes32 digest, bytes calldata sig) internal pure returns (address signer) {
        if (sig.length != 65) revert BadSignature();
        bytes32 r = bytes32(sig[0:32]);
        bytes32 s = bytes32(sig[32:64]);
        uint8 v = uint8(sig[64]);
        if (uint256(s) > HALF_N || (v != 27 && v != 28)) revert BadSignature();
        signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert BadSignature();
    }

    function _hashTypedData(bytes32 structHash) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));
    }

    function _buildDomainSeparator() private view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_TYPEHASH, NAME_HASH, VERSION_HASH, block.chainid, address(this)));
    }

    function _poolKey(address token0, address token1, uint24 fee) private pure returns (bytes32) {
        return keccak256(abi.encode(token0, token1, fee));
    }

    function _transferFrom(address token, address from, address to, uint256 amount) private {
        _call(token, abi.encodeWithSignature("transferFrom(address,address,uint256)", from, to, amount));
    }

    function _transfer(address token, address to, uint256 amount) private {
        _call(token, abi.encodeWithSignature("transfer(address,uint256)", to, amount));
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
