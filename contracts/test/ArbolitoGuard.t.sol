// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ArbolitoGuard as Guard} from "../src/ArbolitoGuard.sol";
import {MockERC20, MockFactory, MockPool, MockSwapRouter} from "./mocks/GuardMocks.sol";

/// Router that misbehaves in a configurable way, to exercise the guard's post-swap invariants.
contract EvilRouter {
    struct ExactInputParams {
        bytes path;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
    }

    enum Mode {
        PullHalf, // consumes less than amountIn (leaves tokens in the guard)
        PayElsewhere, // ignores `recipient`, pays someone else
        Reenter // calls back into the guard mid-swap
    }

    Mode public mode;
    address public thief = address(0xBEEF);
    Guard public guard;
    bytes public reenterPath;
    address public reenterAccount;

    function setMode(Mode m) external {
        mode = m;
    }

    function setReenter(Guard g, address account, bytes calldata path) external {
        guard = g;
        reenterAccount = account;
        reenterPath = path;
    }

    function exactInput(ExactInputParams calldata p) external payable returns (uint256 amountOut) {
        address tokenIn = address(bytes20(p.path[0:20]));
        address tokenOut = address(bytes20(p.path[p.path.length - 20:]));
        if (mode == Mode.PullHalf) {
            MockERC20(tokenIn).transferFrom(msg.sender, address(this), p.amountIn / 2);
            amountOut = p.amountIn;
            MockERC20(tokenOut).mint(p.recipient, amountOut);
        } else if (mode == Mode.PayElsewhere) {
            MockERC20(tokenIn).transferFrom(msg.sender, address(this), p.amountIn);
            amountOut = p.amountIn;
            MockERC20(tokenOut).mint(thief, amountOut);
        } else {
            guard.swapFor(reenterAccount, reenterPath, 1, 0);
        }
    }
}

contract ArbolitoGuardTest is Test {
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

    uint32 constant WINDOW = 600;
    uint256 constant DAY = 1 days;

    Guard guard;
    MockERC20 tA;
    MockERC20 tB;
    MockERC20 tC;
    MockERC20 tX; // not allowlisted
    MockPool poolAB;
    MockPool poolBC;
    MockPool poolAB500; // exists in the factory, not allowlisted
    MockFactory factory;
    MockSwapRouter router;

    address user = makeAddr("user"); // a MiniPay EOA
    address op = makeAddr("operator"); // Arbolito's operator EOA
    address contact = makeAddr("contact");
    address stranger = makeAddr("stranger");
    address user2 = makeAddr("user2");
    address op2 = makeAddr("operator2");

    function setUp() public {
        vm.warp(1_790_000_000); // a realistic clock, mid-day UTC
        tA = new MockERC20("A", 18);
        tB = new MockERC20("B", 18);
        tC = new MockERC20("C", 18);
        tX = new MockERC20("X", 18);
        factory = new MockFactory();
        poolAB = new MockPool(address(tA), address(tB), 100);
        poolBC = new MockPool(address(tB), address(tC), 100);
        poolAB500 = new MockPool(address(tA), address(tB), 500);
        factory.setPool(address(tA), address(tB), 100, address(poolAB));
        factory.setPool(address(tB), address(tC), 100, address(poolBC));
        factory.setPool(address(tA), address(tB), 500, address(poolAB500));
        router = new MockSwapRouter(address(factory));
        guard = _deploy(address(router));

        _fund(user);
        _fund(user2);
    }

    // ------------------------------------------------------------------ helpers
    function _deploy(address router_) internal returns (Guard) {
        address[] memory tokens = new address[](3);
        (tokens[0], tokens[1], tokens[2]) = (address(tA), address(tB), address(tC));
        address[] memory pools = new address[](2);
        (pools[0], pools[1]) = (address(poolAB), address(poolBC));
        return new Guard(router_, address(factory), WINDOW, tokens, pools);
    }

    function _fund(address who) internal {
        tA.mint(who, 1_000e18);
        tB.mint(who, 1_000e18);
        tX.mint(who, 1_000e18);
        vm.startPrank(who);
        tA.approve(address(guard), type(uint256).max);
        tB.approve(address(guard), type(uint256).max);
        tX.approve(address(guard), type(uint256).max);
        vm.stopPrank();
    }

    function _empty(address account) internal pure returns (Guard.Config memory c) {
        c.account = account;
        c.maxSlippageBps = 50;
        c.limits = new Guard.TokenLimit[](0);
        c.recipients = new Guard.Recipient[](0);
        c.prices = new Guard.PriceRef[](0);
    }

    /// Standard config: A and B capped at 100/tx, 150/day; `contact` saved; 0.5% max slippage.
    function _standard(address account) internal view returns (Guard.Config memory c) {
        c = _empty(account);
        c.limits = new Guard.TokenLimit[](2);
        c.limits[0] = Guard.TokenLimit(address(tA), 100e18, 150e18);
        c.limits[1] = Guard.TokenLimit(address(tB), 100e18, 150e18);
        c.recipients = new Guard.Recipient[](1);
        c.recipients[0] = Guard.Recipient(contact, true);
    }

    function _configure(Guard.Config memory c) internal {
        vm.prank(c.account);
        guard.configure(c);
    }

    /// The usual onboarding: standard config plus `op` as operator for a day.
    function _onboard() internal {
        _configure(_standard(user));
        vm.prank(user);
        guard.setOperator(op, uint64(block.timestamp + DAY));
    }

    function _path(address a, uint24 fee, address b) internal pure returns (bytes memory) {
        return abi.encodePacked(a, fee, b);
    }

    function _pathAB() internal view returns (bytes memory) {
        return _path(address(tA), 100, address(tB));
    }

    function _swap(bytes memory path, uint256 amountIn, uint256 minOut) internal returns (uint256) {
        vm.prank(op);
        return guard.swapFor(user, path, amountIn, minOut);
    }

    function _send(address token, address to, uint256 amount) internal {
        vm.prank(op);
        guard.sendFor(user, token, to, amount);
    }

    // ------------------------------------------------------------------ construction
    function test_constructor_allowlists() public view {
        assertTrue(guard.isAllowedToken(address(tA)));
        assertFalse(guard.isAllowedToken(address(tX)));
        assertTrue(guard.isPinnedPool(address(poolAB)));
        assertFalse(guard.isPinnedPool(address(poolAB500)));
        assertEq(guard.poolFor(address(tA), address(tB), 100), address(poolAB));
        assertEq(guard.poolFor(address(tB), address(tA), 100), address(poolAB));
        assertEq(guard.poolFor(address(tA), address(tB), 500), address(0));
        assertEq(guard.twapWindow(), WINDOW);
        assertEq(guard.swapRouter(), address(router));
        assertEq(guard.factory(), address(factory));
    }

    function test_constructor_rejectsPoolNotFromFactory() public {
        MockPool fake = new MockPool(address(tA), address(tC), 100); // never registered in the factory
        address[] memory tokens = new address[](3);
        (tokens[0], tokens[1], tokens[2]) = (address(tA), address(tB), address(tC));
        address[] memory pools = new address[](1);
        pools[0] = address(fake);
        vm.expectRevert(abi.encodeWithSelector(Guard.PoolMismatch.selector, address(fake)));
        new Guard(address(router), address(factory), WINDOW, tokens, pools);
    }

    function test_constructor_rejectsPoolWithUnlistedToken() public {
        address[] memory tokens = new address[](1);
        tokens[0] = address(tA);
        address[] memory pools = new address[](1);
        pools[0] = address(poolAB);
        vm.expectRevert(abi.encodeWithSelector(Guard.TokenNotAllowed.selector, address(tB)));
        new Guard(address(router), address(factory), WINDOW, tokens, pools);
    }

    function test_constructor_rejectsZeroAddresses() public {
        vm.expectRevert(Guard.ZeroAddress.selector);
        new Guard(address(0), address(factory), WINDOW, new address[](0), new address[](0));
        address[] memory tokens = new address[](1);
        vm.expectRevert(Guard.ZeroAddress.selector);
        new Guard(address(router), address(factory), WINDOW, tokens, new address[](0));
    }

    // ------------------------------------------------------------------ never configured
    function test_neverConfigured_isFullyBlocked() public {
        (bool configured, bool paused, uint16 bps) = guard.settings(user);
        assertFalse(configured);
        assertFalse(paused);
        assertEq(bps, 0);
        vm.prank(user);
        guard.setOperator(op, uint64(block.timestamp + DAY));
        // Even with an operator, and even the account itself, nothing moves.
        vm.expectRevert(abi.encodeWithSelector(Guard.NotConfigured.selector, user));
        _swap(_pathAB(), 1e18, 1e18);
        vm.expectRevert(abi.encodeWithSelector(Guard.NotConfigured.selector, user));
        _send(address(tA), contact, 1e18);
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(Guard.NotConfigured.selector, user));
        guard.sendFor(user, address(tA), contact, 1e18);
    }

    function test_configuredWithoutLimits_isStillBlocked() public {
        _configure(_empty(user)); // configured, zero caps
        vm.prank(user);
        guard.setOperator(op, uint64(block.timestamp + DAY));
        vm.expectRevert(abi.encodeWithSelector(Guard.ExceedsTxCap.selector, address(tA), 1e18, 0));
        _swap(_pathAB(), 1e18, 1e18);
        vm.expectRevert(abi.encodeWithSelector(Guard.NotRecipient.selector, contact));
        _send(address(tA), contact, 1e18);
    }

    // ------------------------------------------------------------------ operator lifecycle
    function test_operator_setEmitsAndIsActiveUntilExpiry() public {
        _configure(_standard(user));
        uint64 expiry = uint64(block.timestamp + 1 hours);
        vm.expectEmit(true, true, true, true);
        emit OperatorSet(user, op, expiry);
        vm.prank(user);
        guard.setOperator(op, expiry);
        (address o, uint64 e, bool active) = guard.operatorOf(user);
        assertEq(o, op);
        assertEq(e, expiry);
        assertTrue(active);
        assertTrue(guard.isActiveOperator(user, op));
        assertFalse(guard.isActiveOperator(user, stranger));

        _send(address(tA), contact, 1e18);
        vm.warp(expiry - 1);
        _send(address(tA), contact, 1e18); // last active second
        vm.warp(expiry);
        (,, active) = guard.operatorOf(user);
        assertFalse(active);
        assertFalse(guard.isActiveOperator(user, op));
        vm.expectRevert(abi.encodeWithSelector(Guard.NotOperator.selector, op, user));
        _send(address(tA), contact, 1e18);
        vm.expectRevert(abi.encodeWithSelector(Guard.NotOperator.selector, op, user));
        _swap(_pathAB(), 1e18, 1e18);
        vm.prank(op);
        vm.expectRevert(abi.encodeWithSelector(Guard.NotOperator.selector, op, user));
        guard.pause(user);
    }

    function test_operator_revoke() public {
        _onboard();
        _send(address(tA), contact, 1e18);
        vm.expectEmit(true, true, true, true);
        emit OperatorRevoked(user, op);
        vm.prank(user);
        guard.revokeOperator();
        (address o,, bool active) = guard.operatorOf(user);
        assertEq(o, address(0));
        assertFalse(active);
        vm.expectRevert(abi.encodeWithSelector(Guard.NotOperator.selector, op, user));
        _send(address(tA), contact, 1e18);
        // Idempotent: a second revoke never fails.
        vm.prank(user);
        guard.revokeOperator();
        // The account itself still acts.
        vm.prank(user);
        guard.sendFor(user, address(tA), contact, 1e18);
    }

    function test_operator_onePerAccount_replaceDropsTheOld() public {
        _onboard();
        vm.prank(user);
        guard.setOperator(op2, uint64(block.timestamp + DAY));
        vm.expectRevert(abi.encodeWithSelector(Guard.NotOperator.selector, op, user));
        _send(address(tA), contact, 1e18);
        vm.prank(op2);
        guard.sendFor(user, address(tA), contact, 1e18);
    }

    function test_operator_onlyTheAccountSetsOrRevokes() public {
        _onboard();
        // The operator calling setOperator/revokeOperator only touches ITS OWN slot.
        vm.prank(op);
        guard.setOperator(stranger, uint64(block.timestamp + DAY));
        vm.prank(op);
        guard.revokeOperator();
        (address o,, bool active) = guard.operatorOf(user);
        assertEq(o, op);
        assertTrue(active);
        assertFalse(guard.isActiveOperator(user, stranger));
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Guard.NotOperator.selector, stranger, user));
        guard.sendFor(user, address(tA), contact, 1e18);
    }

    function test_operator_badInputs() public {
        vm.startPrank(user);
        vm.expectRevert(abi.encodeWithSelector(Guard.BadOperator.selector, address(0)));
        guard.setOperator(address(0), uint64(block.timestamp + 1));
        vm.expectRevert(abi.encodeWithSelector(Guard.BadOperator.selector, address(guard)));
        guard.setOperator(address(guard), uint64(block.timestamp + 1));
        vm.expectRevert(abi.encodeWithSelector(Guard.BadOperator.selector, user));
        guard.setOperator(user, uint64(block.timestamp + 1));
        vm.expectRevert(abi.encodeWithSelector(Guard.BadExpiry.selector, uint64(block.timestamp)));
        guard.setOperator(op, uint64(block.timestamp));
        vm.stopPrank();
    }

    function test_operator_cannotActForAnotherAccount() public {
        _onboard();
        _configure(_standard(user2));
        vm.prank(user2);
        guard.setOperator(op2, uint64(block.timestamp + DAY));
        // user's operator against user2, and vice versa.
        vm.prank(op);
        vm.expectRevert(abi.encodeWithSelector(Guard.NotOperator.selector, op, user2));
        guard.sendFor(user2, address(tA), contact, 1e18);
        vm.prank(op);
        vm.expectRevert(abi.encodeWithSelector(Guard.NotOperator.selector, op, user2));
        guard.swapFor(user2, _pathAB(), 1e18, 0.995e18);
        vm.prank(op);
        vm.expectRevert(abi.encodeWithSelector(Guard.NotOperator.selector, op, user2));
        guard.pause(user2);
        vm.prank(op2);
        vm.expectRevert(abi.encodeWithSelector(Guard.NotOperator.selector, op2, user));
        guard.sendFor(user, address(tA), contact, 1e18);
        // A stranger can't act for anyone.
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Guard.NotOperator.selector, stranger, user));
        guard.swapFor(user, _pathAB(), 1e18, 0.995e18);
    }

    function test_accountMayActForItself() public {
        _configure(_standard(user)); // no operator at all
        vm.startPrank(user);
        guard.sendFor(user, address(tA), contact, 1e18);
        guard.swapFor(user, _pathAB(), 1e18, 0.995e18);
        vm.stopPrank();
        assertEq(guard.spentToday(user, address(tA)), 2e18);
    }

    // ------------------------------------------------------------------ configuration
    function test_configure_appliesAndEmits() public {
        Guard.Config memory c = _standard(user);
        c.prices = new Guard.PriceRef[](1);
        c.prices[0] = Guard.PriceRef(address(tA), address(tB), 1e18, 1.1e18, uint64(block.timestamp + 1 hours));
        vm.expectEmit(true, true, true, true);
        emit SettingsSet(user, false, 50);
        vm.expectEmit(true, true, true, true);
        emit TokenLimitSet(user, address(tA), 100e18, 150e18);
        vm.expectEmit(true, true, true, true);
        emit TokenLimitSet(user, address(tB), 100e18, 150e18);
        vm.expectEmit(true, true, true, true);
        emit RecipientSet(user, contact, true);
        vm.expectEmit(true, true, true, true);
        emit PriceRefSet(user, address(tA), address(tB), 1e18, 1.1e18, uint64(block.timestamp + 1 hours));
        vm.expectEmit(true, true, true, true);
        emit Configured(user);
        _configure(c);

        (bool configured, bool paused, uint16 bps) = guard.settings(user);
        assertTrue(configured);
        assertFalse(paused);
        assertEq(bps, 50);
        (uint128 perTx, uint128 perDay) = guard.limits(user, address(tA));
        assertEq(perTx, 100e18);
        assertEq(perDay, 150e18);
        assertTrue(guard.isRecipient(user, contact));
        (uint128 ain, uint128 aout, uint64 exp) = guard.priceRef(user, address(tA), address(tB));
        assertEq(ain, 1e18);
        assertEq(aout, 1.1e18);
        assertEq(exp, uint64(block.timestamp + 1 hours));
        // Per account: user2 untouched.
        (configured,,) = guard.settings(user2);
        assertFalse(configured);
        assertFalse(guard.isRecipient(user2, contact));
    }

    function test_configure_onlyByTheAccountItself() public {
        _onboard();
        // The operator tries to raise user's caps and add itself as a contact: rejected.
        Guard.Config memory c = _standard(user);
        c.limits[0].maxPerTx = type(uint128).max;
        c.limits[0].maxPerDay = type(uint128).max;
        c.recipients[0] = Guard.Recipient(stranger, true);
        vm.prank(op);
        vm.expectRevert(abi.encodeWithSelector(Guard.NotAccount.selector, op, user));
        guard.configure(c);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Guard.NotAccount.selector, stranger, user));
        guard.configure(c);
        (uint128 perTx,) = guard.limits(user, address(tA));
        assertEq(perTx, 100e18);
        assertFalse(guard.isRecipient(user, stranger));

        // A config the operator writes "for itself" lands in the operator's own slot only.
        Guard.Config memory own = _standard(op);
        own.recipients[0] = Guard.Recipient(stranger, true);
        vm.prank(op);
        guard.configure(own);
        assertTrue(guard.isRecipient(op, stranger));
        assertFalse(guard.isRecipient(user, stranger));
        vm.expectRevert(abi.encodeWithSelector(Guard.NotRecipient.selector, stranger));
        _send(address(tA), stranger, 1e18);
    }

    function test_configure_bounds() public {
        Guard.Config memory c = _standard(user);
        c.maxSlippageBps = 1001;
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(Guard.SlippageTooHigh.selector, 1001));
        guard.configure(c);

        c = _standard(user);
        c.maxSlippageBps = 1000; // the max itself is fine
        _configure(c);

        c = _standard(user);
        c.limits[0].token = address(tX);
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(Guard.TokenNotAllowed.selector, address(tX)));
        guard.configure(c);

        address[6] memory bad =
            [address(0), address(guard), address(router), address(tA), address(poolAB), address(poolBC)];
        for (uint256 i; i < bad.length; i++) {
            c = _standard(user);
            c.recipients[0].recipient = bad[i];
            vm.prank(user);
            vm.expectRevert(abi.encodeWithSelector(Guard.BadRecipient.selector, bad[i]));
            guard.configure(c);
        }

        c = _standard(user);
        c.prices = new Guard.PriceRef[](1);
        c.prices[0] = Guard.PriceRef(address(tA), address(tA), 1, 1, 0);
        vm.prank(user);
        vm.expectRevert(Guard.BadPriceRef.selector);
        guard.configure(c);
        c.prices[0] = Guard.PriceRef(address(tA), address(tB), 0, 1, 0); // amountIn 0 with a price
        vm.prank(user);
        vm.expectRevert(Guard.BadPriceRef.selector);
        guard.configure(c);
        c.prices[0] = Guard.PriceRef(address(tA), address(tX), 1, 1, 0);
        vm.prank(user);
        vm.expectRevert(abi.encodeWithSelector(Guard.TokenNotAllowed.selector, address(tX)));
        guard.configure(c);
    }

    // ------------------------------------------------------------------ pause
    function test_pause_operatorPauses_onlyAccountUnpauses() public {
        _onboard();
        vm.expectEmit(true, true, true, true);
        emit Paused(user, op);
        vm.prank(op);
        guard.pause(user);
        (, bool paused,) = guard.settings(user);
        assertTrue(paused);
        vm.expectRevert(abi.encodeWithSelector(Guard.AccountPaused.selector, user));
        _send(address(tA), contact, 1e18);
        vm.expectRevert(abi.encodeWithSelector(Guard.AccountPaused.selector, user));
        _swap(_pathAB(), 1e18, 1e18);
        vm.prank(user); // paused blocks the account's own guarded calls too
        vm.expectRevert(abi.encodeWithSelector(Guard.AccountPaused.selector, user));
        guard.sendFor(user, address(tA), contact, 1e18);

        // The operator cannot unpause (configure is account-only).
        Guard.Config memory c = _empty(user);
        vm.prank(op);
        vm.expectRevert(abi.encodeWithSelector(Guard.NotAccount.selector, op, user));
        guard.configure(c);

        // Strangers can't pause.
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Guard.NotOperator.selector, stranger, user));
        guard.pause(user);

        // The account unpauses; deltas are empty, so caps and contacts are kept.
        _configure(_empty(user));
        _send(address(tA), contact, 1e18);
    }

    function test_pause_byAccountAndByConfig() public {
        _onboard();
        vm.prank(user);
        guard.pause(user);
        vm.expectRevert(abi.encodeWithSelector(Guard.AccountPaused.selector, user));
        _send(address(tA), contact, 1e18);
        Guard.Config memory c = _empty(user);
        c.paused = true;
        _configure(c);
        vm.expectRevert(abi.encodeWithSelector(Guard.AccountPaused.selector, user));
        _send(address(tA), contact, 1e18);
        _configure(_empty(user));
        _send(address(tA), contact, 1e18);
    }

    // ------------------------------------------------------------------ caps
    function test_caps_perTx() public {
        _onboard();
        vm.expectRevert(abi.encodeWithSelector(Guard.ExceedsTxCap.selector, address(tA), 101e18, 100e18));
        _send(address(tA), contact, 101e18);
        vm.expectRevert(abi.encodeWithSelector(Guard.ExceedsTxCap.selector, address(tA), 101e18, 100e18));
        _swap(_pathAB(), 101e18, 101e18);
        _send(address(tA), contact, 100e18);
        assertEq(tA.balanceOf(contact), 100e18);
    }

    function test_caps_perDayAcrossSendAndSwap_andUtcRollover() public {
        _onboard();
        _send(address(tA), contact, 100e18);
        _swap(_pathAB(), 40e18, 39.8e18);
        assertEq(guard.spentToday(user, address(tA)), 140e18);
        vm.expectRevert(abi.encodeWithSelector(Guard.ExceedsDayCap.selector, address(tA), 140e18, 150e18));
        _send(address(tA), contact, 11e18);
        _send(address(tA), contact, 10e18); // exactly at the cap
        // Other tokens have their own bucket.
        _send(address(tB), contact, 100e18);

        // Last second of the UTC day: still capped. First second of the next: reset.
        uint256 nextDay = (block.timestamp / DAY + 1) * DAY;
        vm.warp(nextDay - 1);
        vm.expectRevert(abi.encodeWithSelector(Guard.ExceedsDayCap.selector, address(tA), 150e18, 150e18));
        _send(address(tA), contact, 1);
        vm.warp(nextDay);
        assertEq(guard.spentToday(user, address(tA)), 0);
        _send(address(tA), contact, 100e18);
        assertEq(guard.spentToday(user, address(tA)), 100e18);
    }

    function test_caps_arePerAccount() public {
        _onboard();
        _configure(_standard(user2));
        vm.prank(user2);
        guard.setOperator(op, uint64(block.timestamp + DAY)); // the same operator serves both
        _send(address(tA), contact, 100e18);
        _send(address(tA), contact, 50e18);
        vm.expectRevert(abi.encodeWithSelector(Guard.ExceedsDayCap.selector, address(tA), 150e18, 150e18));
        _send(address(tA), contact, 1);
        // user2's bucket is untouched.
        vm.prank(op);
        guard.sendFor(user2, address(tA), contact, 100e18);
        assertEq(guard.spentToday(user2, address(tA)), 100e18);
        assertEq(guard.spentToday(user, address(tA)), 150e18);
    }

    function test_caps_zeroAmountRejected() public {
        _onboard();
        vm.expectRevert(Guard.ZeroAmount.selector);
        _send(address(tA), contact, 0);
        vm.expectRevert(Guard.ZeroAmount.selector); // amountIn 0 = "router balance" in SwapRouter02
        _swap(_pathAB(), 0, 0);
        vm.expectRevert(Guard.ZeroAmount.selector);
        guard.minOutFloor(user, _pathAB(), 0);
    }

    function test_caps_loweringToZeroBlocksToken() public {
        _onboard();
        Guard.Config memory c = _empty(user);
        c.limits = new Guard.TokenLimit[](1);
        c.limits[0] = Guard.TokenLimit(address(tA), 0, 0);
        _configure(c);
        vm.expectRevert(abi.encodeWithSelector(Guard.ExceedsTxCap.selector, address(tA), 1, 0));
        _send(address(tA), contact, 1);
    }

    function test_allowanceIsTheHardCeiling() public {
        _onboard();
        vm.prank(user);
        tA.approve(address(guard), 5e18); // caps allow 100/tx, the allowance only 5
        vm.expectRevert(abi.encodeWithSelector(Guard.TransferFailed.selector, address(tA))); // allowance underflow
        _send(address(tA), contact, 6e18);
        _send(address(tA), contact, 5e18);
        assertEq(tA.allowance(user, address(guard)), 0);
    }

    // ------------------------------------------------------------------ contacts
    function test_send_toContact_emits_andGuardHoldsNothing() public {
        _onboard();
        vm.expectEmit(true, true, true, true);
        emit Sent(user, address(tA), contact, op, 5e18);
        _send(address(tA), contact, 5e18);
        assertEq(tA.balanceOf(contact), 5e18);
        assertEq(tA.balanceOf(user), 995e18);
        assertEq(tA.balanceOf(address(guard)), 0);
    }

    function test_send_toStrangerRejected() public {
        _onboard();
        vm.expectRevert(abi.encodeWithSelector(Guard.NotRecipient.selector, stranger));
        _send(address(tA), stranger, 1e18);
        vm.expectRevert(abi.encodeWithSelector(Guard.NotRecipient.selector, op));
        _send(address(tA), op, 1e18); // nor to the operator itself
    }

    function test_send_contactRemoved() public {
        _onboard();
        Guard.Config memory c = _empty(user);
        c.recipients = new Guard.Recipient[](1);
        c.recipients[0] = Guard.Recipient(contact, false);
        _configure(c);
        vm.expectRevert(abi.encodeWithSelector(Guard.NotRecipient.selector, contact));
        _send(address(tA), contact, 1e18);
    }

    function test_send_contactsArePerAccount() public {
        _onboard();
        _configure(_empty(user2)); // no contacts
        vm.prank(user2);
        guard.setOperator(op, uint64(block.timestamp + DAY));
        vm.prank(op);
        vm.expectRevert(abi.encodeWithSelector(Guard.NotRecipient.selector, contact));
        guard.sendFor(user2, address(tA), contact, 1e18);
    }

    // ------------------------------------------------------------------ token and pool allowlist
    function test_tokenAllowlist() public {
        _onboard();
        vm.expectRevert(abi.encodeWithSelector(Guard.TokenNotAllowed.selector, address(tX)));
        _send(address(tX), contact, 1e18);
        vm.expectRevert(abi.encodeWithSelector(Guard.TokenNotAllowed.selector, address(tX)));
        _swap(_path(address(tX), 100, address(tB)), 1e18, 0);
        vm.expectRevert(abi.encodeWithSelector(Guard.TokenNotAllowed.selector, address(tX)));
        _swap(_path(address(tA), 100, address(tX)), 1e18, 0);
    }

    function test_poolAllowlist() public {
        _onboard();
        vm.expectRevert(abi.encodeWithSelector(Guard.PoolNotAllowed.selector, address(tA), address(tB), uint24(500)));
        _swap(_path(address(tA), 500, address(tB)), 1e18, 1e18);
        // No allowlisted A/C pool.
        vm.expectRevert(abi.encodeWithSelector(Guard.PoolNotAllowed.selector, address(tA), address(tC), uint24(100)));
        _swap(_path(address(tA), 100, address(tC)), 1e18, 1e18);
    }

    function test_badPaths() public {
        _onboard();
        vm.expectRevert(Guard.BadPath.selector);
        _swap(abi.encodePacked(address(tA), uint24(100)), 1e18, 1e18);
        vm.expectRevert(Guard.BadPath.selector); // round trip A -> B -> A
        _swap(abi.encodePacked(address(tA), uint24(100), address(tB), uint24(100), address(tA)), 1e18, 1e18);
        bytes memory long = abi.encodePacked(_pathAB(), uint24(100), address(tC), uint24(100), address(tB));
        long = abi.encodePacked(long, uint24(100), address(tC));
        vm.expectRevert(Guard.BadPath.selector); // 4 hops > MAX_HOPS
        _swap(long, 1e18, 1e18);
        vm.expectRevert(Guard.BadPath.selector); // trailing garbage
        _swap(abi.encodePacked(_pathAB(), uint8(1)), 1e18, 1e18);
    }

    // ------------------------------------------------------------------ swaps
    function test_swap_happyPath_recipientIsAccount_approvalReset_event() public {
        _onboard();
        uint256 floor = guard.minOutFloor(user, _pathAB(), 10e18);
        assertEq(floor, 9.95e18); // tick 0 => 1:1, less 50 bps
        vm.expectEmit(true, true, true, true);
        emit Swapped(user, address(tA), address(tB), op, 10e18, 9.99e18, floor, floor);
        uint256 out = _swap(_pathAB(), 10e18, floor);
        assertEq(out, 9.99e18);
        assertEq(router.lastRecipient(), user);
        assertEq(tA.balanceOf(user), 990e18);
        assertEq(tB.balanceOf(user), 1_000e18 + 9.99e18);
        assertEq(tA.allowance(address(guard), address(router)), 0, "approval reset");
        assertEq(tA.balanceOf(address(guard)), 0, "guard holds nothing");
        assertEq(tB.balanceOf(address(guard)), 0);
        assertEq(tB.balanceOf(op), 0, "operator gets nothing");
    }

    function test_swap_minOutZeroRejected() public {
        _onboard();
        vm.expectRevert(abi.encodeWithSelector(Guard.MinOutBelowFloor.selector, 0, 9.95e18));
        _swap(_pathAB(), 10e18, 0);
    }

    function test_swap_minOutJustBelowFloorRejected() public {
        _onboard();
        vm.expectRevert(abi.encodeWithSelector(Guard.MinOutBelowFloor.selector, 9.95e18 - 1, 9.95e18));
        _swap(_pathAB(), 10e18, 9.95e18 - 1);
    }

    function test_swap_floorFollowsTwapTick() public {
        _onboard();
        poolAB.setTick(6932); // 1.0001^6932 ~= 2.0
        uint256 floor = guard.minOutFloor(user, _pathAB(), 1e18);
        uint256 expected = address(tA) < address(tB) ? 2e18 : 0.5e18;
        assertApproxEqRel(floor, expected * 9950 / 10_000, 1e15);
    }

    function test_swap_multiHopFloorChains() public {
        _onboard();
        bytes memory path = abi.encodePacked(address(tA), uint24(100), address(tB), uint24(100), address(tC));
        assertEq(guard.minOutFloor(user, path, 10e18), 9.95e18);
        _swap(path, 10e18, 9.95e18);
        assertEq(tC.balanceOf(user), 10e18 * 9990 / 10_000 * 9990 / 10_000);
    }

    function test_swap_routerCannotUnderdeliver() public {
        _onboard();
        router.setRateBps(9900); // 1% worse than the floor allows
        vm.expectRevert("Too little received");
        _swap(_pathAB(), 10e18, 9.95e18);
    }

    function test_swap_slippageZeroMeansAtLeastTwap() public {
        Guard.Config memory c = _standard(user);
        c.maxSlippageBps = 0;
        _configure(c);
        vm.prank(user);
        guard.setOperator(op, uint64(block.timestamp + DAY));
        vm.expectRevert(abi.encodeWithSelector(Guard.MinOutBelowFloor.selector, 9.99e18, 10e18));
        _swap(_pathAB(), 10e18, 9.99e18);
    }

    function test_swap_postSwapInvariants() public {
        EvilRouter evil = new EvilRouter();
        guard = _deploy(address(evil));
        _fund(user);
        _onboard();

        evil.setMode(EvilRouter.Mode.PullHalf);
        vm.expectRevert(abi.encodeWithSelector(Guard.UnexpectedBalance.selector, address(tA)));
        _swap(_pathAB(), 10e18, 9.95e18);

        evil.setMode(EvilRouter.Mode.PayElsewhere);
        vm.expectRevert(abi.encodeWithSelector(Guard.UnexpectedBalance.selector, address(tB)));
        _swap(_pathAB(), 10e18, 9.95e18);

        evil.setMode(EvilRouter.Mode.Reenter);
        evil.setReenter(guard, user, _pathAB());
        vm.expectRevert(Guard.Reentrancy.selector);
        _swap(_pathAB(), 10e18, 9.95e18);
        assertEq(guard.spentToday(user, address(tA)), 0, "reverted swaps record nothing");
    }

    // ------------------------------------------------------------------ price reference (TWAP fallback)
    function test_twapDown_noReference_reverts() public {
        _onboard();
        poolAB.setOracleDown(true);
        (bool ok,) = guard.twapQuote(address(poolAB), address(tA), address(tB), 1e18);
        assertFalse(ok);
        vm.expectRevert(abi.encodeWithSelector(Guard.NoPriceReference.selector, address(tA), address(tB)));
        _swap(_pathAB(), 10e18, 10e18);
    }

    function test_twapDown_accountReferenceIsUsedUntilExpiry() public {
        Guard.Config memory c = _standard(user);
        c.prices = new Guard.PriceRef[](1);
        c.prices[0] = Guard.PriceRef(address(tA), address(tB), 1e18, 0.999e18, uint64(block.timestamp + 1 hours));
        _configure(c);
        vm.prank(user);
        guard.setOperator(op, uint64(block.timestamp + 2 days));
        poolAB.setOracleDown(true);
        uint256 floor = guard.minOutFloor(user, _pathAB(), 10e18);
        assertEq(floor, 9.99e18 * 9950 / 10_000);
        _swap(_pathAB(), 10e18, floor);
        vm.warp(block.timestamp + 1 hours + 1);
        vm.expectRevert(abi.encodeWithSelector(Guard.NoPriceReference.selector, address(tA), address(tB)));
        _swap(_pathAB(), 10e18, floor);
    }

    function test_reference_isStricterOfTheTwo_andClears() public {
        Guard.Config memory c = _standard(user);
        c.prices = new Guard.PriceRef[](1);
        // The account says A is worth 1.2 B; the pool TWAP says 1.0. The floor uses 1.2.
        c.prices[0] = Guard.PriceRef(address(tA), address(tB), 1e18, 1.2e18, uint64(block.timestamp + 1 hours));
        _configure(c);
        assertEq(guard.minOutFloor(user, _pathAB(), 10e18), 12e18 * 9950 / 10_000);
        // A LOWER reference never loosens the TWAP floor.
        c = _empty(user);
        c.prices = new Guard.PriceRef[](1);
        c.prices[0] = Guard.PriceRef(address(tA), address(tB), 1e18, 0.5e18, uint64(block.timestamp + 1 hours));
        _configure(c);
        assertEq(guard.minOutFloor(user, _pathAB(), 10e18), 9.95e18);
        // Clearing it (amountOut 0) goes back to the TWAP alone.
        c.prices[0] = Guard.PriceRef(address(tA), address(tB), 0, 0, 0);
        _configure(c);
        assertEq(guard.minOutFloor(user, _pathAB(), 10e18), 9.95e18);
        // References are per account: user2 has none.
        _configure(_standard(user2));
        poolAB.setOracleDown(true);
        vm.expectRevert(abi.encodeWithSelector(Guard.NoPriceReference.selector, address(tA), address(tB)));
        guard.minOutFloor(user2, _pathAB(), 10e18);
    }

    // ------------------------------------------------------------------ fuzz
    /// Whatever the operator passes, money only ever goes to the account or a saved contact,
    /// and the guard ends holding nothing.
    function testFuzz_operatorCanOnlyPayAccountOrContacts(uint96 amountIn, uint96 minOut, address to, bool doSwap)
        public
    {
        vm.assume(to != contact && to != user);
        _onboard();
        uint256 a0 = tA.balanceOf(user);
        uint256 b0 = tB.balanceOf(user);
        vm.prank(op);
        if (doSwap) {
            try guard.swapFor(user, _pathAB(), amountIn, minOut) returns (uint256 out) {
                assertGe(out, guard.minOutFloor(user, _pathAB(), amountIn));
                assertEq(tB.balanceOf(user), b0 + out);
                assertEq(tA.balanceOf(user), a0 - amountIn);
            } catch {}
        } else {
            try guard.sendFor(user, address(tA), to, amountIn) {
                revert("paid a stranger");
            } catch {}
        }
        assertEq(tA.balanceOf(address(guard)), 0);
        assertEq(tB.balanceOf(address(guard)), 0);
        assertEq(tA.balanceOf(op), 0);
        assertEq(tB.balanceOf(op), 0);
    }
}
