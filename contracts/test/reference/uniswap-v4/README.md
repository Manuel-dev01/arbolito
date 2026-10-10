# Uniswap v4-core reference libraries (test-only)

Unmodified copies of `src/libraries/{TickMath,FullMath,BitMath,CustomRevert}.sol` from
https://github.com/Uniswap/v4-core at commit `46c6834698c48bc4a463a86d8420f4eb1d7f3b75`
(each file is `SPDX-License-Identifier: MIT`).

They are used only by `contracts/test/UniswapV3MathDifferential.t.sol`, which fuzzes
`contracts/src/lib/UniswapV3Math.sol` (our ports used by ArbolitoSessionExecutor) against
these upstream implementations. They are never deployed.
