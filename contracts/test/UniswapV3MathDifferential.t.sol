// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {FullMath, TickMath} from "../src/lib/UniswapV3Math.sol";
import {FullMath as RefFullMath} from "./reference/uniswap-v4/FullMath.sol";
import {TickMath as RefTickMath} from "./reference/uniswap-v4/TickMath.sol";

/// External wrappers so reverts can be compared with try/catch.
contract OursHarness {
    function sqrtAtTick(int24 tick) external pure returns (uint160) {
        return TickMath.getSqrtRatioAtTick(tick);
    }

    function mulDiv(uint256 a, uint256 b, uint256 d) external pure returns (uint256) {
        return FullMath.mulDiv(a, b, d);
    }
}

contract RefHarness {
    function sqrtAtTick(int24 tick) external pure returns (uint160) {
        return RefTickMath.getSqrtPriceAtTick(tick);
    }

    function mulDiv(uint256 a, uint256 b, uint256 d) external pure returns (uint256) {
        return RefFullMath.mulDiv(a, b, d);
    }
}

/// Differential tests: our ports (used by ArbolitoSessionExecutor's price floor) must agree
/// exactly with Uniswap v4-core's MIT libraries, value for value and revert for revert.
contract UniswapV3MathDifferentialTest is Test {
    OursHarness internal ours;
    RefHarness internal ref;

    int24 internal constant MIN_TICK = -887272;
    int24 internal constant MAX_TICK = 887272;

    function setUp() public {
        ours = new OursHarness();
        ref = new RefHarness();
    }

    function _sqrtBoth(int24 tick) internal view returns (bool okA, uint160 a, bool okB, uint160 b) {
        try ours.sqrtAtTick(tick) returns (uint160 v) {
            (okA, a) = (true, v);
        } catch {}
        try ref.sqrtAtTick(tick) returns (uint160 v) {
            (okB, b) = (true, v);
        } catch {}
    }

    function testFuzz_sqrtPriceAtTick_matchesUpstream(int24 tick) public view {
        tick = int24(bound(int256(tick), MIN_TICK, MAX_TICK));
        (bool okA, uint160 a, bool okB, uint160 b) = _sqrtBoth(tick);
        assertTrue(okA && okB, "both must succeed in range");
        assertEq(a, b, "sqrtPriceX96 mismatch");
    }

    function testFuzz_sqrtPriceAtTick_outOfRange_bothRevert(int24 raw, bool below) public view {
        // Map straight into the out-of-range region (vm.assume would reject most inputs).
        int24 tick = below
            ? int24(bound(int256(raw), type(int24).min, int256(MIN_TICK) - 1))
            : int24(bound(int256(raw), int256(MAX_TICK) + 1, type(int24).max));
        (bool okA,, bool okB,) = _sqrtBoth(tick);
        assertFalse(okA, "ours must revert out of range");
        assertFalse(okB, "upstream reverts out of range");
    }

    function test_sqrtPriceAtTick_edgesAndLiveTicks() public view {
        int24[9] memory ticks = [MIN_TICK, MIN_TICK + 1, -276325, -1, int24(0), 1, 276324, MAX_TICK - 1, MAX_TICK];
        for (uint256 i; i < ticks.length; i++) {
            (bool okA, uint160 a, bool okB, uint160 b) = _sqrtBoth(ticks[i]);
            assertTrue(okA && okB);
            assertEq(a, b);
        }
    }

    function testFuzz_mulDiv_matchesUpstream(uint256 a, uint256 b, uint256 d) public view {
        bool okA;
        bool okB;
        uint256 x;
        uint256 y;
        try ours.mulDiv(a, b, d) returns (uint256 v) {
            (okA, x) = (true, v);
        } catch {}
        try ref.mulDiv(a, b, d) returns (uint256 v) {
            (okB, y) = (true, v);
        } catch {}
        assertEq(okA, okB, "revert behaviour differs");
        if (okA) assertEq(x, y, "mulDiv mismatch");
    }

    /// Bias toward the full-precision path (product overflows 256 bits but the result fits).
    function testFuzz_mulDiv_512bitPath(uint128 hiA, uint128 hiB, uint256 d) public view {
        uint256 a = (uint256(hiA) << 128) | 1;
        uint256 b = (uint256(hiB) << 128) | 3;
        d = bound(d, (a / type(uint128).max) + 1, type(uint256).max);
        bool okA;
        bool okB;
        uint256 x;
        uint256 y;
        try ours.mulDiv(a, b, d) returns (uint256 v) {
            (okA, x) = (true, v);
        } catch {}
        try ref.mulDiv(a, b, d) returns (uint256 v) {
            (okB, y) = (true, v);
        } catch {}
        assertEq(okA, okB, "revert behaviour differs");
        if (okA) assertEq(x, y, "mulDiv mismatch");
    }
}
