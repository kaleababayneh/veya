import Image from "next/image";
import Link from "next/link";
import { VeyaMotion } from "@/components/VeyaMotion";

const Arrow = () => <span aria-hidden="true">↗</span>;
export default function Home() {
  return <VeyaMotion>
    <section className="veya-hero" aria-labelledby="hero-title">
      <Image src="/brand/bosphorus-options/option-1.webp" alt="A couple at a Bosphorus café table, one showing the other something on a phone, a ferry passing on the water behind them" fill unoptimized loading="eager" fetchPriority="high" sizes="100vw" className="hero-photo" />
      <div className="hero-shade" />
      <div className="hero-copy">
        <p className="eyebrow">A familiar way forward</p>
        <h1 id="hero-title">Your lira.<br />A world of<br /><em>possibility.</em></h1>
        <p className="hero-description">Buy USDC or XLM from peers.<br />Pay with your Turkish bank account.</p>
        <Link href="/market" className="veya-button pistachio">Explore Veya <Arrow /></Link>
      </div>
      <div className="hero-foot"><span>Made for the way you move.</span><span>Built on Stellar <span aria-hidden="true">↗</span></span></div>
    </section>

    <div className="veya-rail"><span>Turkish lira in.</span><span className="rail-line" /><span>USDC or XLM out.</span><span className="rail-note">One peer-to-peer exchange.</span></div>

    <section className="veya-intro section-width" data-reveal>
      <p className="eyebrow">Your bank. Your wallet.</p>
      <h2>A little more<br />within reach.</h2>
      <p>From the account you know<br />to the wallet you own.</p>
    </section>

    <section className="veya-story section-width" aria-label="How Veya works">
      <article className="story-panel story-choose" data-reveal>
        <div className="story-copy"><span className="step-number">01 / CHOOSE</span><h2>Find your<br />starting point.</h2><p>Choose a peer’s offer.<br />See the price before you reserve.</p><Link className="veya-button ivory" href="/market">Find an offer <Arrow /></Link></div>
        <div className="exchange-art" aria-label="Illustration of Turkish lira exchanged for digital currency">
          <div className="currency-disc lira">₺</div><div className="exchange-path" aria-hidden="true">↗</div><div className="currency-disc dollar">$</div><span className="art-caption">TRY → USDC / XLM</span>
        </div>
      </article>
      <article className="story-panel story-transfer" data-reveal>
        <div className="story-copy"><span className="step-number">02 / TRANSFER</span><h2>Same bank.<br />New possibilities.</h2><p>Pay the seller by FAST from Ziraat<br />or VakıfBank. Keep the receipt email.</p><Link className="text-link" href="/how-it-works">See how it works <Arrow /></Link></div>
        <div className="receipt-scene"><div className="receipt"><span className="receipt-top">BANK TRANSFER <span aria-hidden="true">↗</span></span><span className="receipt-symbol">₺</span><strong>One familiar step.</strong><span>From your bank to your peer.</span><div className="receipt-rule" /><span className="receipt-bottom">FAST <span>Payment receipt</span></span></div><span className="art-caption">An illustration of the payment step</span></div>
      </article>
      <article className="story-panel story-receive" data-reveal>
        <div className="story-copy"><span className="step-number">03 / VERIFY & RECEIVE</span><h2>Proof in.<br />Crypto out.</h2><p>Upload the original receipt email.<br />Verify your payment, then claim<br />your crypto to your wallet.</p><Link className="veya-button pistachio" href="/market">Take a look <Arrow /></Link></div>
        <div className="proof-art"><div className="proof-orbit"><svg viewBox="0 0 100 100" aria-hidden="true"><path d="M25 51 43 69 77 32" fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" /></svg></div><span>Verified. Ready for your wallet.</span></div>
      </article>
    </section>

    <section className="veya-trust section-width" data-reveal>
      <div><p className="eyebrow">Built around the exchange</p><h2>Less guesswork.<br />More clarity.</h2></div>
      <div className="trust-details"><div><span>01</span><h3>Crypto held for the trade.</h3><p>The seller’s tokens stay in a smart contract while the trade is reserved.</p></div><div><span>02</span><h3>A receipt you can verify.</h3><p>Settlement uses proof of the bank’s signed email, rather than a screenshot.</p></div><Link className="text-link" href="/how-it-works">Understand the safeguards and limits <Arrow /></Link></div>
    </section>

    <section className="veya-faq section-width" data-reveal><h2>A few good questions.</h2><div>
      <details><summary>What do I need to get started?<span>+</span></summary><p>A supported Stellar wallet, and a Ziraat or VakıfBank account for the FAST payment. You’ll upload the original receipt email as an .eml file.</p></details>
      <details><summary>Is Veya live?<span>+</span></summary><p>Veya is currently on Stellar testnet. The crypto is testnet crypto, with no monetary value. Bank transfers use real lira, so read the trade instructions before paying.</p></details>
      <details><summary>Who can see my receipt?<span>+</span></summary><p>The proving service processes the original email. The receipt itself is not published on-chain. The operator still has responsibilities and control; see How it works for the current trust model.</p></details>
    </div></section>

    <section className="veya-close" data-reveal><p className="eyebrow">A new way, starting here.</p><h2>Meet your<br />next move.</h2><Link className="veya-button pistachio" href="/market">Explore the testnet <Arrow /></Link><p className="testnet-note">Stellar testnet · Test tokens, real bank transfers.</p><div className="closing-wordmark" aria-hidden="true">veya<span>↗</span></div></section>
    <footer className="veya-footer"><Link href="/" className="veya-wordmark">veya</Link><span>From Türkiye. Built on Stellar.</span><div><Link href="/market">Market</Link><Link href="/sell">Sell crypto</Link><Link href="/how-it-works">How it works</Link></div><span className="footer-small">Veya is an experimental peer-to-peer interface. Operator and smart-contract risks apply.</span></footer>
  </VeyaMotion>;
}
