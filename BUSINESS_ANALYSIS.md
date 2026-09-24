# Virtual try-on: where this business may work—and where it probably won't

_Working analysis, 2026-09-24. This is a decision framework, not proof of product-market fit or financial advice._

## The product in one sentence

Give someone a fast visual comparison of garments before they buy. The compelling demo is the live “I can see myself wearing it” moment. That does **not** mean the model measures physical fit or predicts returns.

## The cost floor

Decart currently lists Lucy VTON 3.5 realtime at **$0.02 per second of active generation** ([pricing](https://docs.platform.decart.ai/getting-started/pricing)). This is a variable cost, not a fixed server subscription. The table excludes payment fees, taxes, support, failed sessions, hosting, refunds, acquisition, and any other model calls.

| Active generation | Model cost at listed rate |
| ---: | ---: |
| 10 seconds | $0.20 |
| 30 seconds | $0.60 |
| 1 minute | $1.20 |
| 2 minutes | $2.40 |
| 5 minutes | $6.00 |
| 10 minutes | $12.00 |

A $10 five-minute pass leaves **$4 before every other cost**. A $10 ten-minute pass loses **$2 on inference alone**. A free 30-second trial costs up to $0.60 per full-use visitor; 1,000 full-use trials would be $600 with no revenue. Real bills depend on active generation and current provider terms. Check pricing again before setting prices.

## Routes worth testing

1. **Paid decision sessions for high-consideration shopping.** Sell a capped, prepaid session to someone comparing a small set of expensive items. The value proposition is a better decision, not a generic entertainment mirror. Before accepting payment, the service would need verified entitlement, capacity admission, a hard session cap, and credit restoration when generation fails. None of those payment controls are in this demo.
2. **Merchant-funded product discovery.** A retailer might fund try-on if it measurably improves qualified purchases or reduces returns enough to cover usage. This requires a controlled test against ordinary product pages. A nicer demo or more time-on-site is not proof of sales lift.
3. **B2B installation with usage pass-through.** A brand, creator, or event could pay for setup, support, and a metered allowance. This may be easier to price than unlimited consumer access, but the buyer still needs reliability, privacy terms, and an operator when sessions fail.
4. **Build education and source kits.** Sell the reproducible extension, setup instructions, and lessons learned to developers. The seller does not fund every buyer's inference because each buyer uses their own Decart account. Demand for a viral demo is not yet evidence of demand for a course or template; measure purchases and successful installs.

## Routes to avoid until the evidence changes

- **Generous uncapped free trials or unlimited subscriptions.** Per-second spend can exceed revenue quickly, especially when a video sends curiosity traffic.
- **“Accurate fit” or size guarantees.** A visual try-on does not establish garment dimensions, fabric behavior, or body measurements.
- **A shared public API key or unrestricted token endpoint.** Usage can be abused and billed to the operator. Keep the permanent key server-side and issue scoped client tokens as [Decart recommends](https://docs.platform.decart.ai/models/realtime/virtual-try-on#client-token-security).
- **Selling access before capacity and recovery work.** Prepayment protects cash collection, not user experience. A paid customer still needs a working session, queue/admission control if capacity is scarce, and a fair failed-session policy.

## Minimum proof before calling it a business

For consumer sessions: track checkout completion, successful first AI frame, usable session duration, item comparisons completed, refunds, repeat purchase, and fully loaded contribution margin. For merchants: measure incremental purchases or returns against a control. For a build kit: measure paid buyers who install it and see their own first AI frame. These outcomes are **not yet established** by the existing demo or reel views.

## Implementation reality

The included extension is a local Chrome/Brave demo backed by a Node token server. It has a draggable garment workflow, popup/tutorial, and holographic transition. Its website showroom checkout is intentionally disabled. Automated tests pass, and an operated Brave test returned generated camera video with Cobalt knit, then changed to Clay everyday (`proof.md`). An earlier `Model not permitted` response remains a relevant access failure mode for buyers without Lucy VTON entitlement. A production service needs authenticated accounts, spend quotas, payment entitlements, capacity handling, HTTPS, privacy disclosures, and browser QA. This is not a ready-to-sell consumer service.

Sources: [Decart pricing](https://docs.platform.decart.ai/getting-started/pricing), [Lucy VTON API and client-token guidance](https://docs.platform.decart.ai/models/realtime/virtual-try-on), and the included local source/proof record. Business routes and customer value claims above are hypotheses to test, not provider claims.
