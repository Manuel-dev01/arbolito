// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ArbolitoSessionExecutor as Guard} from "../src/ArbolitoSessionExecutor.sol";
import {FullMath, TickMath, OracleMath} from "../src/lib/UniswapV3Math.sol";
import {
    MockERC20,
    MockAdminAccount,
    MockFactory,
    MockPool,
    MockSwapRouter,
    MockReactor
} from "./mocks/GuardMocks.sol";

contract ArbolitoSessionExecutorTest is Test {
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
    event ConfigApplied(address indexed account, address indexed admin, uint256 nonce);
    event TokenLimitSet(address indexed account, address indexed token, uint128 maxPerTx, uint128 maxPerDay);
    event RecipientSet(address indexed account, address indexed recipient, bool allowed);
    event SettingsSet(address indexed account, bool paused, uint16 maxSlippageBps);
    event Paused(address indexed account);
    event TextileFilled(
        address indexed account,
        address indexed sellToken,
        address indexed buyToken,
        uint256 sold,
        uint256 bought,
        uint256 floor
    );

    uint32 constant WINDOW = 600;
    uint256 constant ADMIN_KEY = 0xA11CE;
    uint256 constant SESSION_KEY = 0x5E55;
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
    MockReactor reactor;
    MockAdminAccount account;
    address admin;
    address contact = makeAddr("contact");
    address stranger = makeAddr("stranger");

    function setUp() public {
        vm.warp(1_790_000_000); // a realistic clock, mid-day UTC
        admin = vm.addr(ADMIN_KEY);
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
        reactor = new MockReactor();

        address[] memory tokens = new address[](3);
        (tokens[0], tokens[1], tokens[2]) = (address(tA), address(tB), address(tC));
        address[] memory pools = new address[](2);
        (pools[0], pools[1]) = (address(poolAB), address(poolBC));
        guard = new Guard(address(router), address(factory), address(reactor), WINDOW, tokens, pools);

        account = new MockAdminAccount(admin);
        tA.mint(address(account), 1_000e18);
        tB.mint(address(account), 1_000e18);
        tX.mint(address(account), 1_000e18);
        account.approve(address(tA), address(guard), type(uint256).max);
        account.approve(address(tB), address(guard), type(uint256).max);
        account.approve(address(tX), address(guard), type(uint256).max);
    }

    // ------------------------------------------------------------------ helpers
    function _empty() internal view returns (Guard.ConfigUpdate memory u) {
        u.account = address(account);
        (,, u.nonce) = guard.settings(address(account));
        u.deadline = block.timestamp + 1 hours;
        u.maxSlippageBps = 50;
        u.limits = new Guard.TokenLimit[](0);
        u.recipients = new Guard.Recipient[](0);
        u.prices = new Guard.PriceRef[](0);
    }

    /// Standard config: A and B capped at 100/tx, 150/day; `contact` saved; 0.5% max slippage.
    function _standard() internal view returns (Guard.ConfigUpdate memory u) {
        u = _empty();
        u.limits = new Guard.TokenLimit[](2);
        u.limits[0] = Guard.TokenLimit(address(tA), 100e18, 150e18);
        u.limits[1] = Guard.TokenLimit(address(tB), 100e18, 150e18);
        u.recipients = new Guard.Recipient[](1);
        u.recipients[0] = Guard.Recipient(contact, true);
    }

    /// EIP-712 digest computed independently of the contract's own hashing.
    function _digest(Guard.ConfigUpdate memory u) internal view returns (bytes32) {
        bytes32[] memory h = new bytes32[](u.limits.length);
        for (uint256 i; i < h.length; i++) {
            h[i] = keccak256(
                abi.encode(
                    keccak256("TokenLimit(address token,uint128 maxPerTx,uint128 maxPerDay)"),
                    u.limits[i].token,
                    u.limits[i].maxPerTx,
                    u.limits[i].maxPerDay
                )
            );
        }
        bytes32 lh = keccak256(abi.encodePacked(h));
        h = new bytes32[](u.recipients.length);
        for (uint256 i; i < h.length; i++) {
            h[i] = keccak256(
                abi.encode(
                    keccak256("Recipient(address recipient,bool allowed)"), u.recipients[i].recipient, u.recipients[i].allowed
                )
            );
        }
        bytes32 rh = keccak256(abi.encodePacked(h));
        h = new bytes32[](u.prices.length);
        for (uint256 i; i < h.length; i++) {
            Guard.PriceRef memory p = u.prices[i];
            h[i] = keccak256(
                abi.encode(
                    keccak256("PriceRef(address tokenIn,address tokenOut,uint128 amountIn,uint128 amountOut,uint64 expiry)"),
                    p.tokenIn,
                    p.tokenOut,
                    p.amountIn,
                    p.amountOut,
                    p.expiry
                )
            );
        }
        bytes32 ph = keccak256(abi.encodePacked(h));
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256(
                    "ConfigUpdate(address account,uint256 nonce,uint256 deadline,bool paused,uint16 maxSlippageBps,TokenLimit[] limits,Recipient[] recipients,PriceRef[] prices)PriceRef(address tokenIn,address tokenOut,uint128 amountIn,uint128 amountOut,uint64 expiry)Recipient(address recipient,bool allowed)TokenLimit(address token,uint128 maxPerTx,uint128 maxPerDay)"
                ),
                u.account,
                u.nonce,
                u.deadline,
                u.paused,
                u.maxSlippageBps,
                lh,
                rh,
                ph
            )
        );
        bytes32 domain = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("ArbolitoSessionExecutor"),
                keccak256("1"),
                block.chainid,
                address(guard)
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", domain, structHash));
    }

    function _sign(uint256 key, Guard.ConfigUpdate memory u) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, _digest(u));
        return abi.encodePacked(r, s, v);
    }

    function _apply(Guard.ConfigUpdate memory u) internal {
        guard.applyConfig(u, _sign(ADMIN_KEY, u));
    }

    function _path(address a, uint24 fee, address b) internal pure returns (bytes memory) {
        return abi.encodePacked(a, fee, b);
    }

    function _pathAB() internal view returns (bytes memory) {
        return _path(address(tA), 100, address(tB));
    }

    function _swap(bytes memory path, uint256 amountIn, uint256 minOut) internal returns (uint256) {
        vm.prank(address(account));
        return guard.swapExactInput(path, amountIn, minOut);
    }

    function _send(address token, address to, uint256 amount) internal {
        vm.prank(address(account));
        guard.send(token, to, amount);
    }

    // ------------------------------------------------------------------ construction
    function test_constructor_allowlists() public view {
        assertTrue(guard.isAllowedToken(address(tA)));
        assertFalse(guard.isAllowedToken(address(tX)));
        assertEq(guard.poolFor(address(tA), address(tB), 100), address(poolAB));
        assertEq(guard.poolFor(address(tB), address(tA), 100), address(poolAB));
        assertEq(guard.poolFor(address(tA), address(tB), 500), address(0));
        assertEq(guard.twapWindow(), WINDOW);
        assertEq(guard.swapRouter(), address(router));
    }

    function test_constructor_rejectsPoolNotFromFactory() public {
        MockPool fake = new MockPool(address(tA), address(tC), 100); // never registered in the factory
        address[] memory tokens = new address[](3);
        (tokens[0], tokens[1], tokens[2]) = (address(tA), address(tB), address(tC));
        address[] memory pools = new address[](1);
        pools[0] = address(fake);
        vm.expectRevert(abi.encodeWithSelector(Guard.PoolMismatch.selector, address(fake)));
        new Guard(address(router), address(factory), address(0), WINDOW, tokens, pools);
    }

    function test_constructor_rejectsPoolWithUnlistedToken() public {
        address[] memory tokens = new address[](1);
        tokens[0] = address(tA);
        address[] memory pools = new address[](1);
        pools[0] = address(poolAB);
        vm.expectRevert(abi.encodeWithSelector(Guard.TokenNotAllowed.selector, address(tB)));
        new Guard(address(router), address(factory), address(0), WINDOW, tokens, pools);
    }

    // ------------------------------------------------------------------ defaults
    function test_default_everythingBlocked() public {
        (bool paused, uint16 bps, uint256 nonce) = guard.settings(address(account));
        assertFalse(paused);
        assertEq(bps, 0);
        assertEq(nonce, 0);
        vm.expectRevert(abi.encodeWithSelector(Guard.ExceedsTxCap.selector, address(tA), 1e18, 0));
        _swap(_pathAB(), 1e18, 1e18);
        vm.expectRevert(abi.encodeWithSelector(Guard.NotRecipient.selector, contact));
        _send(address(tA), contact, 1e18);
    }

    // ------------------------------------------------------------------ config signatures
    function test_config_goodSignatureApplies() public {
        Guard.ConfigUpdate memory u = _standard();
        assertEq(guard.hashConfigUpdate(u), _structHashViaContract(u));
        vm.expectEmit(true, true, true, true);
        emit SettingsSet(address(account), false, 50);
        vm.expectEmit(true, true, true, true);
        emit TokenLimitSet(address(account), address(tA), 100e18, 150e18);
        vm.expectEmit(true, true, true, true);
        emit TokenLimitSet(address(account), address(tB), 100e18, 150e18);
        vm.expectEmit(true, true, true, true);
        emit RecipientSet(address(account), contact, true);
        vm.expectEmit(true, true, true, true);
        emit ConfigApplied(address(account), admin, 0);
        vm.prank(stranger); // anyone may submit (the relayer pays gas)
        guard.applyConfig(u, _sign(ADMIN_KEY, u));

        (uint128 perTx, uint128 perDay) = guard.limits(address(account), address(tA));
        assertEq(perTx, 100e18);
        assertEq(perDay, 150e18);
        assertTrue(guard.isRecipient(address(account), contact));
        (, uint16 bps, uint256 nonce) = guard.settings(address(account));
        assertEq(bps, 50);
        assertEq(nonce, 1);
    }

    function _structHashViaContract(Guard.ConfigUpdate memory u) internal view returns (bytes32) {
        return guard.hashConfigUpdate(u);
    }

    function test_config_digestMatchesContract() public view {
        Guard.ConfigUpdate memory u = _standard();
        u.prices = new Guard.PriceRef[](1);
        u.prices[0] = Guard.PriceRef(address(tA), address(tB), 1e18, 2e18, uint64(block.timestamp + 1));
        bytes32 expected = keccak256(abi.encodePacked("\x19\x01", guard.DOMAIN_SEPARATOR(), guard.hashConfigUpdate(u)));
        assertEq(_digest(u), expected);
    }

    function test_config_sessionKeyCannotRaiseItsOwnCaps() public {
        // The session key acts as the account but is not an admin of it.
        Guard.ConfigUpdate memory u = _standard();
        u.limits[0].maxPerTx = type(uint128).max;
        vm.expectRevert(abi.encodeWithSelector(Guard.NotAdmin.selector, vm.addr(SESSION_KEY)));
        vm.prank(address(account));
        guard.applyConfig(u, _sign(SESSION_KEY, u));
    }

    function test_config_wrongSignerReverts() public {
        Guard.ConfigUpdate memory u = _standard();
        vm.expectRevert(abi.encodeWithSelector(Guard.NotAdmin.selector, vm.addr(0xBAD)));
        guard.applyConfig(u, _sign(0xBAD, u));
    }

    function test_config_tamperedPayloadReverts() public {
        Guard.ConfigUpdate memory u = _standard();
        bytes memory sig = _sign(ADMIN_KEY, u);
        u.limits[0].maxPerDay = 1_000_000e18; // relayer edits the signed caps
        vm.expectRevert(); // recovers some other address -> NotAdmin
        guard.applyConfig(u, sig);
    }

    function test_config_replayReverts() public {
        Guard.ConfigUpdate memory u = _standard();
        bytes memory sig = _sign(ADMIN_KEY, u);
        guard.applyConfig(u, sig);
        vm.expectRevert(abi.encodeWithSelector(Guard.BadNonce.selector, 1, 0));
        guard.applyConfig(u, sig);
    }

    function test_config_expiredReverts() public {
        Guard.ConfigUpdate memory u = _standard();
        bytes memory sig = _sign(ADMIN_KEY, u);
        vm.warp(u.deadline + 1);
        vm.expectRevert(Guard.ExpiredSignature.selector);
        guard.applyConfig(u, sig);
    }

    function test_config_otherAccountsSignatureDoesNotTransfer() public {
        // Admin of account A signs; the update names account B, whose admin is someone else.
        MockAdminAccount other = new MockAdminAccount(makeAddr("otherAdmin"));
        Guard.ConfigUpdate memory u = _standard();
        u.account = address(other);
        vm.expectRevert(abi.encodeWithSelector(Guard.NotAdmin.selector, admin));
        guard.applyConfig(u, _sign(ADMIN_KEY, u));
    }

    function test_config_rejectsMalleableAndMalformedSignatures() public {
        Guard.ConfigUpdate memory u = _standard();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(ADMIN_KEY, _digest(u));
        uint256 n = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141;
        bytes memory highS = abi.encodePacked(r, bytes32(n - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        vm.expectRevert(Guard.BadSignature.selector);
        guard.applyConfig(u, highS);
        vm.expectRevert(Guard.BadSignature.selector);
        guard.applyConfig(u, abi.encodePacked(r, s));
    }

    function test_config_eoaAccountNeverHasAdmins() public {
        Guard.ConfigUpdate memory u = _standard();
        u.account = admin; // an EOA: no isAdmin()
        vm.expectRevert(abi.encodeWithSelector(Guard.NotAdmin.selector, admin));
        guard.applyConfig(u, _sign(ADMIN_KEY, u));
    }

    function test_config_bounds() public {
        Guard.ConfigUpdate memory u = _standard();
        u.maxSlippageBps = 1001;
        vm.expectRevert(abi.encodeWithSelector(Guard.SlippageTooHigh.selector, 1001));
        _apply(u);

        u = _standard();
        u.limits[0].token = address(tX);
        vm.expectRevert(abi.encodeWithSelector(Guard.TokenNotAllowed.selector, address(tX)));
        _apply(u);

        u = _standard();
        u.recipients[0].recipient = address(guard);
        vm.expectRevert(Guard.ZeroAddress.selector);
        _apply(u);

        u = _standard();
        u.prices = new Guard.PriceRef[](1);
        u.prices[0] = Guard.PriceRef(address(tA), address(tA), 1, 1, 0);
        vm.expectRevert(Guard.BadPriceRef.selector);
        _apply(u);
    }

    // ------------------------------------------------------------------ caps
    function test_caps_perTx() public {
        _apply(_standard());
        vm.expectRevert(abi.encodeWithSelector(Guard.ExceedsTxCap.selector, address(tA), 101e18, 100e18));
        _send(address(tA), contact, 101e18);
        _send(address(tA), contact, 100e18);
        assertEq(tA.balanceOf(contact), 100e18);
    }

    function test_caps_perDayAcrossSendAndSwap_andRollover() public {
        _apply(_standard());
        _send(address(tA), contact, 100e18);
        _swap(_pathAB(), 40e18, 39.8e18);
        assertEq(guard.spentToday(address(account), address(tA)), 140e18);
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
        assertEq(guard.spentToday(address(account), address(tA)), 0);
        _send(address(tA), contact, 100e18);
        assertEq(guard.spentToday(address(account), address(tA)), 100e18);
    }

    function test_caps_zeroAmountReverts() public {
        _apply(_standard());
        vm.expectRevert(Guard.ZeroAmount.selector);
        _send(address(tA), contact, 0);
        vm.expectRevert(Guard.ZeroAmount.selector); // amountIn 0 = "router balance" in SwapRouter02
        _swap(_pathAB(), 0, 0);
    }

    function test_caps_loweringToZeroBlocksToken() public {
        _apply(_standard());
        Guard.ConfigUpdate memory u = _empty();
        u.limits = new Guard.TokenLimit[](1);
        u.limits[0] = Guard.TokenLimit(address(tA), 0, 0);
        _apply(u);
        vm.expectRevert(abi.encodeWithSelector(Guard.ExceedsTxCap.selector, address(tA), 1, 0));
        _send(address(tA), contact, 1);
    }

    // ------------------------------------------------------------------ recipients
    function test_send_toContact_emits() public {
        _apply(_standard());
        vm.expectEmit(true, true, true, true);
        emit Sent(address(account), address(tA), contact, 5e18);
        _send(address(tA), contact, 5e18);
        assertEq(tA.balanceOf(contact), 5e18);
        assertEq(tA.balanceOf(address(guard)), 0);
    }

    function test_send_toStrangerReverts() public {
        _apply(_standard());
        vm.expectRevert(abi.encodeWithSelector(Guard.NotRecipient.selector, stranger));
        _send(address(tA), stranger, 1e18);
    }

    function test_send_contactRemoved() public {
        _apply(_standard());
        Guard.ConfigUpdate memory u = _empty();
        u.recipients = new Guard.Recipient[](1);
        u.recipients[0] = Guard.Recipient(contact, false);
        _apply(u);
        vm.expectRevert(abi.encodeWithSelector(Guard.NotRecipient.selector, contact));
        _send(address(tA), contact, 1e18);
    }

    function test_send_contactsArePerAccount() public {
        _apply(_standard());
        MockAdminAccount other = new MockAdminAccount(admin);
        tA.mint(address(other), 10e18);
        other.approve(address(tA), address(guard), type(uint256).max);
        vm.prank(address(other));
        vm.expectRevert(abi.encodeWithSelector(Guard.NotRecipient.selector, contact));
        guard.send(address(tA), contact, 1e18);
    }

    // ------------------------------------------------------------------ token allowlist
    function test_tokenAllowlist() public {
        _apply(_standard());
        vm.expectRevert(abi.encodeWithSelector(Guard.TokenNotAllowed.selector, address(tX)));
        _send(address(tX), contact, 1e18);
        vm.expectRevert(abi.encodeWithSelector(Guard.TokenNotAllowed.selector, address(tX)));
        _swap(_path(address(tX), 100, address(tB)), 1e18, 0);
        vm.expectRevert(abi.encodeWithSelector(Guard.TokenNotAllowed.selector, address(tX)));
        _swap(_path(address(tA), 100, address(tX)), 1e18, 0);
    }

    function test_poolAllowlist() public {
        _apply(_standard());
        vm.expectRevert(abi.encodeWithSelector(Guard.PoolNotAllowed.selector, address(tA), address(tB), uint24(500)));
        _swap(_path(address(tA), 500, address(tB)), 1e18, 1e18);
        // No allowlisted A/C pool.
        vm.expectRevert(abi.encodeWithSelector(Guard.PoolNotAllowed.selector, address(tA), address(tC), uint24(100)));
        _swap(_path(address(tA), 100, address(tC)), 1e18, 1e18);
    }

    function test_badPaths() public {
        _apply(_standard());
        vm.expectRevert(Guard.BadPath.selector);
        _swap(abi.encodePacked(address(tA), uint24(100)), 1e18, 1e18);
        vm.expectRevert(Guard.BadPath.selector); // round trip A -> B -> A
        _swap(abi.encodePacked(address(tA), uint24(100), address(tB), uint24(100), address(tA)), 1e18, 1e18);
        bytes memory long = abi.encodePacked(_pathAB(), uint24(100), address(tC), uint24(100), address(tB));
        long = abi.encodePacked(long, uint24(100), address(tC));
        vm.expectRevert(Guard.BadPath.selector); // 4 hops > MAX_HOPS
        _swap(long, 1e18, 1e18);
    }

    // ------------------------------------------------------------------ swaps
    function test_swap_happyPath_recipientIsAccount_approvalReset_event() public {
        _apply(_standard());
        uint256 floor = guard.minOutFloor(address(account), _pathAB(), 10e18);
        assertEq(floor, 9.95e18); // tick 0 => 1:1, less 50 bps
        vm.expectEmit(true, true, true, true);
        emit Swapped(address(account), address(tA), address(tB), 10e18, 9.99e18, floor, floor);
        uint256 out = _swap(_pathAB(), 10e18, floor);
        assertEq(out, 9.99e18);
        assertEq(router.lastRecipient(), address(account));
        assertEq(tB.balanceOf(address(account)), 1_000e18 + 9.99e18);
        assertEq(tA.allowance(address(guard), address(router)), 0, "approval reset");
        assertEq(tA.balanceOf(address(guard)), 0, "guard holds nothing");
        assertEq(tB.balanceOf(address(guard)), 0);
    }

    function test_swap_minOutZeroReverts() public {
        _apply(_standard());
        vm.expectRevert(abi.encodeWithSelector(Guard.MinOutBelowFloor.selector, 0, 9.95e18));
        _swap(_pathAB(), 10e18, 0);
    }

    function test_swap_minOutJustBelowFloorReverts() public {
        _apply(_standard());
        vm.expectRevert(abi.encodeWithSelector(Guard.MinOutBelowFloor.selector, 9.95e18 - 1, 9.95e18));
        _swap(_pathAB(), 10e18, 9.95e18 - 1);
    }

    function test_swap_floorFollowsTwapTick() public {
        _apply(_standard());
        poolAB.setTick(6932); // 1.0001^6932 ~= 2.0
        // A < B? the quote direction depends on token order; both must be ~2x or ~0.5x.
        uint256 floor = guard.minOutFloor(address(account), _pathAB(), 1e18);
        uint256 expected = address(tA) < address(tB) ? 2e18 : 0.5e18;
        assertApproxEqRel(floor, expected * 9950 / 10_000, 1e15);
    }

    function test_swap_multiHopFloorChains() public {
        _apply(_standard());
        bytes memory path = abi.encodePacked(address(tA), uint24(100), address(tB), uint24(100), address(tC));
        assertEq(guard.minOutFloor(address(account), path, 10e18), 9.95e18);
        _swap(path, 10e18, 9.95e18);
        assertEq(tC.balanceOf(address(account)), 10e18 * 9990 / 10_000 * 9990 / 10_000);
    }

    function test_swap_routerCannotUnderdeliver() public {
        _apply(_standard());
        router.setRateBps(9900); // 1% worse than the floor allows
        vm.expectRevert("Too little received");
        _swap(_pathAB(), 10e18, 9.95e18);
    }

    function test_swap_slippageZeroMeansAtLeastTwap() public {
        Guard.ConfigUpdate memory u = _standard();
        u.maxSlippageBps = 0;
        _apply(u);
        vm.expectRevert(abi.encodeWithSelector(Guard.MinOutBelowFloor.selector, 9.99e18, 10e18));
        _swap(_pathAB(), 10e18, 9.99e18);
    }

    // ------------------------------------------------------------------ TWAP fallback (reference price)
    function test_twapDown_noReference_reverts() public {
        _apply(_standard());
        poolAB.setOracleDown(true);
        vm.expectRevert(abi.encodeWithSelector(Guard.NoPriceReference.selector, address(tA), address(tB)));
        _swap(_pathAB(), 10e18, 10e18);
    }

    function test_twapDown_signedReferenceIsUsedUntilExpiry() public {
        Guard.ConfigUpdate memory u = _standard();
        u.prices = new Guard.PriceRef[](1);
        u.prices[0] = Guard.PriceRef(address(tA), address(tB), 1e18, 0.999e18, uint64(block.timestamp + 1 hours));
        _apply(u);
        poolAB.setOracleDown(true);
        uint256 floor = guard.minOutFloor(address(account), _pathAB(), 10e18);
        assertEq(floor, 9.99e18 * 9950 / 10_000);
        _swap(_pathAB(), 10e18, floor);
        vm.warp(block.timestamp + 1 hours + 1);
        vm.expectRevert(abi.encodeWithSelector(Guard.NoPriceReference.selector, address(tA), address(tB)));
        _swap(_pathAB(), 10e18, floor);
    }

    function test_reference_isStricterOfTheTwo() public {
        Guard.ConfigUpdate memory u = _standard();
        u.prices = new Guard.PriceRef[](1);
        // Admin says A is worth 1.2 B; the pool TWAP says 1.0. The floor uses 1.2.
        u.prices[0] = Guard.PriceRef(address(tA), address(tB), 1e18, 1.2e18, uint64(block.timestamp + 1 hours));
        _apply(u);
        assertEq(guard.minOutFloor(address(account), _pathAB(), 10e18), 12e18 * 9950 / 10_000);
        // Clearing it (amountOut 0) goes back to the TWAP.
        u = _empty();
        u.prices = new Guard.PriceRef[](1);
        u.prices[0] = Guard.PriceRef(address(tA), address(tB), 0, 0, 0);
        _apply(u);
        assertEq(guard.minOutFloor(address(account), _pathAB(), 10e18), 9.95e18);
    }

    // ------------------------------------------------------------------ pause
    function test_pause_bySignedConfig() public {
        Guard.ConfigUpdate memory u = _standard();
        u.paused = true;
        _apply(u);
        vm.expectRevert(abi.encodeWithSelector(Guard.AccountPaused.selector, address(account)));
        _send(address(tA), contact, 1e18);
        vm.expectRevert(abi.encodeWithSelector(Guard.AccountPaused.selector, address(account)));
        _swap(_pathAB(), 1e18, 1e18);
        u = _empty(); // unpause needs another admin signature
        _apply(u);
        _send(address(tA), contact, 1e18);
    }

    function test_pause_selfPauseVoidsPendingUpdates() public {
        _apply(_standard());
        Guard.ConfigUpdate memory pending = _empty(); // signed, not yet submitted
        bytes memory sig = _sign(ADMIN_KEY, pending);
        vm.expectEmit(true, true, true, true);
        emit Paused(address(account));
        vm.prank(address(account)); // the session key can only make itself weaker
        guard.pause();
        vm.expectRevert(abi.encodeWithSelector(Guard.AccountPaused.selector, address(account)));
        _send(address(tA), contact, 1e18);
        vm.expectRevert(abi.encodeWithSelector(Guard.BadNonce.selector, 2, 1));
        guard.applyConfig(pending, sig);
        _apply(_empty()); // a fresh signature at the new nonce unpauses
        _send(address(tA), contact, 1e18);
    }

    // ------------------------------------------------------------------ Textile passthrough
    function _order(address sellToken, uint256 pull, address pullTo, address buyToken, uint256 give)
        internal
        pure
        returns (bytes memory)
    {
        MockReactor.SignedOrder memory o =
            MockReactor.SignedOrder(abi.encode(sellToken, pull, pullTo, buyToken, give), "");
        return abi.encodeCall(MockReactor.execute, (o));
    }

    function _fill(uint256 maxSell, uint256 minBought, bytes memory call_) internal returns (uint256, uint256) {
        vm.prank(address(account));
        return guard.fillTextile(address(tA), maxSell, address(tB), minBought, call_);
    }

    function test_textile_fillForwardsAndRefunds() public {
        _apply(_standard());
        address maker = makeAddr("maker");
        // Lends 10 A, maker takes 8 and pays 8.1 B; 2 A come back.
        bytes memory c = _order(address(tA), 8e18, maker, address(tB), 8.1e18);
        vm.expectEmit(true, true, true, true);
        emit TextileFilled(address(account), address(tA), address(tB), 8e18, 8.1e18, 8e18 * 9950 / 10_000);
        (uint256 sold, uint256 bought) = _fill(10e18, 8e18, c);
        assertEq(sold, 8e18);
        assertEq(bought, 8.1e18);
        assertEq(tA.balanceOf(address(account)), 1_000e18 - 8e18);
        assertEq(tB.balanceOf(address(account)), 1_000e18 + 8.1e18);
        assertEq(tA.balanceOf(address(guard)), 0);
        assertEq(tB.balanceOf(address(guard)), 0);
        assertEq(tA.allowance(address(guard), address(reactor)), 0);
        assertEq(guard.spentToday(address(account), address(tA)), 8e18);
    }

    function test_textile_badPriceRejected() public {
        _apply(_standard());
        // An attacker-signed "order": takes 10 A, gives 1 wei of B.
        bytes memory c = _order(address(tA), 10e18, stranger, address(tB), 1);
        vm.expectRevert(abi.encodeWithSelector(Guard.MinOutBelowFloor.selector, 1, 9.95e18));
        _fill(10e18, 0, c);
    }

    function test_textile_cannotPullMoreThanLent() public {
        _apply(_standard());
        bytes memory c = _order(address(tA), 11e18, stranger, address(tB), 11e18);
        vm.expectRevert(); // allowance is exactly maxSell
        _fill(10e18, 0, c);
    }

    function test_textile_capsAndSelectors() public {
        _apply(_standard());
        vm.expectRevert(abi.encodeWithSelector(Guard.ExceedsTxCap.selector, address(tA), 101e18, 100e18));
        _fill(101e18, 0, _order(address(tA), 1, stranger, address(tB), 1));
        vm.expectRevert(Guard.BadReactorCall.selector);
        _fill(1e18, 0, abi.encodeCall(MockReactor.owner, ()));
        vm.expectRevert(Guard.BadReactorCall.selector);
        _fill(1e18, 0, hex"00");
        vm.expectRevert(Guard.ZeroAmount.selector); // nothing sold
        _fill(1e18, 0, abi.encodeCall(MockReactor.executeBatch, (new MockReactor.SignedOrder[](0))));
        vm.expectRevert(abi.encodeWithSelector(Guard.BoughtBelowMin.selector, 1e18, 2e18));
        _fill(1e18, 2e18, _order(address(tA), 1e18, stranger, address(tB), 1e18));
    }

    function test_textile_disabledWithoutReactor() public {
        address[] memory tokens = new address[](1);
        tokens[0] = address(tA);
        Guard g = new Guard(address(router), address(factory), address(0), WINDOW, tokens, new address[](0));
        vm.expectRevert(Guard.TextileDisabled.selector);
        g.fillTextile(address(tA), 1, address(tB), 0, "");
    }

    // ------------------------------------------------------------------ math
    function test_tickMath_knownValues() public pure {
        assertEq(TickMath.getSqrtRatioAtTick(0), 2 ** 96);
        assertEq(TickMath.getSqrtRatioAtTick(TickMath.MIN_TICK), 4295128739);
        assertEq(
            TickMath.getSqrtRatioAtTick(TickMath.MAX_TICK), 1461446703485210103287273052203988822378723970342
        );
    }

    function test_meanTick_roundsTowardNegativeInfinity() public pure {
        assertEq(OracleMath.meanTick(0, -601, 600), -2);
        assertEq(OracleMath.meanTick(0, -600, 600), -1);
        assertEq(OracleMath.meanTick(0, 601, 600), 1);
    }

    function testFuzz_mulDiv_matchesNaive(uint128 a, uint128 b, uint128 d) public pure {
        vm.assume(d > 0);
        assertEq(FullMath.mulDiv(a, b, d), uint256(a) * b / d);
    }

    function test_mulDiv_fullPrecision() public pure {
        assertEq(FullMath.mulDiv(type(uint256).max, type(uint256).max, type(uint256).max), type(uint256).max);
        assertEq(FullMath.mulDiv(2 ** 200, 2 ** 100, 2 ** 150), 2 ** 150);
    }
}
