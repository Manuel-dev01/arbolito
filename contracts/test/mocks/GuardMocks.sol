// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// Test-only stand-ins for the ArbolitoSessionExecutor unit tests.

contract MockERC20 {
    string public name;
    uint8 public immutable decimals;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory name_, uint8 decimals_) {
        name = name_;
        decimals = decimals_;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 a = allowance[from][msg.sender];
        if (a != type(uint256).max) allowance[from][msg.sender] = a - amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// thirdweb-style account surface: only `isAdmin` matters to the guard.
contract MockAdminAccount {
    mapping(address => bool) public isAdmin;

    constructor(address admin) {
        isAdmin[admin] = true;
    }

    function approve(address token, address spender, uint256 amount) external {
        MockERC20(token).approve(spender, amount);
    }
}

contract MockFactory {
    mapping(bytes32 => address) internal pools;

    function setPool(address a, address b, uint24 fee, address pool) external {
        pools[keccak256(abi.encode(a, b, fee))] = pool;
        pools[keccak256(abi.encode(b, a, fee))] = pool;
    }

    function getPool(address a, address b, uint24 fee) external view returns (address) {
        return pools[keccak256(abi.encode(a, b, fee))];
    }
}

/// Oracle-only pool: a constant tick over all history, or a revert ("OLD") to simulate low cardinality.
contract MockPool {
    address public immutable token0;
    address public immutable token1;
    uint24 public immutable fee;
    int24 public tick;
    bool public oracleDown;

    constructor(address a, address b, uint24 fee_) {
        (token0, token1) = a < b ? (a, b) : (b, a);
        fee = fee_;
    }

    function setTick(int24 t) external {
        tick = t;
    }

    function setOracleDown(bool down) external {
        oracleDown = down;
    }

    function observe(uint32[] calldata secondsAgos)
        external
        view
        returns (int56[] memory tickCumulatives, uint160[] memory secondsPerLiquidityCumulativeX128s)
    {
        require(!oracleDown, "OLD");
        tickCumulatives = new int56[](secondsAgos.length);
        secondsPerLiquidityCumulativeX128s = new uint160[](secondsAgos.length);
        for (uint256 i; i < secondsAgos.length; i++) {
            tickCumulatives[i] = int56(tick) * int56(uint56(block.timestamp - secondsAgos[i]));
        }
    }
}

/// SwapRouter02 `exactInput` stand-in: pays `rateBps` / 10000 of amountIn per hop (tokens share decimals).
contract MockSwapRouter {
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    address public immutable factory;
    uint256 public rateBps = 9990;
    address public lastRecipient;

    constructor(address factory_) {
        factory = factory_;
    }

    function setRateBps(uint256 r) external {
        rateBps = r;
    }

    function exactInput(ExactInputParams calldata p) external payable returns (uint256 amountOut) {
        bytes calldata path = p.path;
        address tokenIn = address(bytes20(path[0:20]));
        address tokenOut = address(bytes20(path[path.length - 20:]));
        uint256 hops = (path.length - 20) / 23;
        MockERC20(tokenIn).transferFrom(msg.sender, address(this), p.amountIn);
        amountOut = p.amountIn;
        for (uint256 i; i < hops; i++) {
            amountOut = amountOut * rateBps / 10_000;
        }
        require(amountOut >= p.amountOutMinimum, "Too little received");
        MockERC20(tokenOut).mint(p.recipient, amountOut);
        lastRecipient = p.recipient;
    }
}

/// Reactor stand-in with the real `execute((bytes,bytes))` selector. The "order" says how much of
/// the filler's sell token to pull (and to whom) and how much buy token to hand the filler.
contract MockReactor {
    struct SignedOrder {
        bytes order;
        bytes sig;
    }

    function execute(SignedOrder calldata o) external payable {
        (address sellToken, uint256 pull, address pullTo, address buyToken, uint256 give) =
            abi.decode(o.order, (address, uint256, address, address, uint256));
        MockERC20(sellToken).transferFrom(msg.sender, pullTo, pull);
        MockERC20(buyToken).mint(msg.sender, give);
    }

    function executeBatch(SignedOrder[] calldata) external payable {}

    function owner() external pure returns (address) {
        return address(0);
    }
}
