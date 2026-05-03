/**
 * Single source of truth for URL classification + email validation.
 *
 * Imported by:
 *   - /lib/scan/classifier.ts        (classifyUrl: hostname → UrlClass)
 *   - /lib/scan/trust.ts             (Standard-tier email identity check)
 *   - /lib/enterprise/domainMatch.ts (Complex+ domain-match validation)
 *
 * Match semantics, by category:
 *   - GLOBAL_ENTERPRISE_DOMAINS / INDIAN_ENTERPRISE_DOMAINS:
 *     hostname === d  ||  hostname.endsWith('.' + d)
 *     (so `mail.tatamotors.com` classifies as Indian enterprise)
 *   - INSTITUTION_TLDS:
 *     hostname.endsWith(tld)
 *   - FREE_PROVIDERS:
 *     emailDomain === d (exact match — no subdomain semantics for email)
 *
 * Curation notes:
 *   - GLOBAL/INDIAN domain lists are an Indian-context first-pass: cover
 *     the AI tools cluster (Claude, OpenAI, Perplexity, etc.), big tech
 *     (Google, Meta, Apple, Microsoft, Amazon), social/comms separates
 *     (instagram.com is a separate root from meta.com — owners type either),
 *     major dev infrastructure (GitHub, GitLab, Stripe, Vercel), major
 *     Indian banks / fintech / commerce / auto / media / telecom, plus a
 *     handful of US institutions Indian users commonly type. Not exhaustive.
 *     Extend whenever a real customer hits a gap. Tranco top 500 each is
 *     the eventual target — keep alphabetical order on every addition.
 *   - INSTITUTION_TLDS is closed: ICANN-defined TLDs only, no curation drift.
 *   - FREE_PROVIDERS is closed by intent — adding a provider here changes
 *     who can self-serve a Standard-tier scan. Edit deliberately.
 */

/**
 * Free email providers — never accepted for enterprise / institution /
 * complex-tier verification. Owners using these on Standard-tier sites
 * (11–50 pages) get a Phase 2 trust finding instead of a hard block.
 */
export const FREE_PROVIDERS = [
  'gmail.com',
  'hotmail.com',
  'icloud.com',
  'me.com',
  'outlook.com',
  'protonmail.com',
  'rediffmail.com',
  'yahoo.com',
  'ymail.com',
  'zoho.com',
] as const

/**
 * Path A — global enterprise. Pricing ₹49,999+, always manual approval.
 *
 * Includes the AI tools cluster (Anthropic, OpenAI, Perplexity, Mistral,
 * Cohere, HuggingFace, Stability, Character.AI) which the original stub
 * list missed entirely — `claude.ai` was in particular flagged by the
 * founder as something the platform must obviously not let scan as a
 * ₹49 self-serve.
 *
 * Note on subdomain semantics: matching is `hostname === d ||
 * hostname.endsWith('.' + d)`. So adding `meta.com` catches
 * `developers.meta.com` but NOT `instagram.com` — Meta's properties
 * each need their own root entry. Same for `google.com` vs
 * `youtube.com`. Both listed below.
 */
export const GLOBAL_ENTERPRISE_DOMAINS = [
  'adobe.com',
  'airbnb.com',
  'amazon.com',
  'amazon.in',
  'americanexpress.com',
  'anthropic.com',
  'apple.com',
  'atlassian.com',
  'bbc.com',
  'bitbucket.org',
  'bloomberg.com',
  'canva.com',
  'character.ai',
  'chatgpt.com',
  'claude.ai',
  'cloudflare.com',
  'cnn.com',
  'cohere.com',
  'coursera.org',
  'dell.com',
  'digitalocean.com',
  'discord.com',
  'dropbox.com',
  'duolingo.com',
  'ebay.com',
  'facebook.com',
  'figma.com',
  'github.com',
  'gitlab.com',
  'google.com',
  'hp.com',
  'huggingface.co',
  'ibm.com',
  'instagram.com',
  'intel.com',
  'khanacademy.org',
  'linkedin.com',
  'mastercard.com',
  'meta.com',
  'microsoft.com',
  'mistral.ai',
  'netflix.com',
  'notion.so',
  'nvidia.com',
  'nytimes.com',
  'openai.com',
  'oracle.com',
  'paypal.com',
  'perplexity.ai',
  'pinterest.com',
  'reddit.com',
  'reuters.com',
  'salesforce.com',
  'samsung.com',
  'shopify.com',
  'signal.org',
  'slack.com',
  'snapchat.com',
  'sony.com',
  'spotify.com',
  'stability.ai',
  'stripe.com',
  'telegram.org',
  'tesla.com',
  'threads.net',
  'tiktok.com',
  'toyota.com',
  'twilio.com',
  'twitter.com',
  'uber.com',
  'udemy.com',
  'vercel.com',
  'visa.com',
  'whatsapp.com',
  'wikipedia.org',
  'wordpress.com',
  'x.com',
  'yahoo.com',
  'youtube.com',
  'zoom.us',
] as const

/**
 * Path B — Indian enterprise. Pricing ₹9,999–₹24,999, always manual approval.
 *
 * Coverage by sector: banking (HDFC, SBI, ICICI, Axis, Kotak, Bajaj
 * Finserv, PNB), fintech (Paytm, PhonePe, Razorpay, Zerodha, Groww,
 * BillDesk, CRED), commerce (Flipkart, Meesho, Nykaa, BigBasket, Blinkit,
 * Swiggy, Zomato, IndiaMART, JustDial, Snapdeal, Myntra, Urban Company),
 * conglomerates (Tata, Reliance, Adani, Aditya Birla, Godrej, Mahindra),
 * IT services (TCS, Infosys, Wipro, HCL, Tech Mahindra, LTIMindtree,
 * Mphasis, Birlasoft), telecom (Airtel, Jio, Vi, BSNL), travel (MakeMyTrip,
 * Goibibo, Yatra, Cleartrip, ixigo, RedBus, OYO, IRCTC), auto (Tata Motors,
 * Mahindra, Bajaj, Hero, Ola), real estate (MagicBricks, 99acres, Housing,
 * NoBroker), media (Times of India / indiatimes, Hindustan Times, NDTV,
 * The Hindu, News18, Indian Express, Moneycontrol, LiveMint), and the
 * mygov.in portal which would otherwise miss the .gov.in TLD catch.
 */
export const INDIAN_ENTERPRISE_DOMAINS = [
  '99acres.com',
  'adani.com',
  'adityabirla.com',
  'airtel.in',
  'axisbank.com',
  'bajajauto.com',
  'bajajfinserv.in',
  'bigbasket.com',
  'billdesk.com',
  'birlasoft.com',
  'blinkit.com',
  'bseindia.com',
  'bsnl.in',
  'cardekho.com',
  'carwale.com',
  'cleartrip.com',
  'cred.club',
  'dunzo.com',
  'flipkart.com',
  'godrej.com',
  'goibibo.com',
  'groww.in',
  'hcltech.com',
  'hdfcbank.com',
  'heromotocorp.com',
  'hindustantimes.com',
  'housing.com',
  'icicibank.com',
  'indiamart.com',
  'indianexpress.com',
  'indiatimes.com',
  'infosys.com',
  'irctc.co.in',
  'ixigo.com',
  'jio.com',
  'justdial.com',
  'kotak.com',
  'livemint.com',
  'ltimindtree.com',
  'magicbricks.com',
  'mahindra.com',
  'makemytrip.com',
  'meesho.com',
  'moneycontrol.com',
  'mphasis.com',
  'mygov.in',
  'myntra.com',
  'ndtv.com',
  'news18.com',
  'nobroker.in',
  'nseindia.com',
  'nykaa.com',
  'ola.com',
  'olacabs.com',
  'olx.in',
  'oyorooms.com',
  'paytm.com',
  'phonepe.com',
  'pnbindia.in',
  'quikr.com',
  'rapido.bike',
  'razorpay.com',
  'redbus.in',
  'reliancedigital.in',
  'ril.com',
  'sbi.co.in',
  'shaadi.com',
  'snapdeal.com',
  'swiggy.com',
  'tata.com',
  'tatamotors.com',
  'tcs.com',
  'techmahindra.com',
  'thehindu.com',
  'urbancompany.com',
  'vi.in',
  'wipro.com',
  'yatra.com',
  'zerodha.com',
  'zomato.com',
] as const

/**
 * Path C — institution / non-profit / government. Domain-match OTP required;
 * pricing ₹999–₹4,999 by sub-type for Indian institutions, manual quote per
 * inquiry for foreign ones (admin sets the price after OTP verification).
 *
 * Coverage: India (.ac.in, .edu.in, .gov, .gov.in, .mil.in, .ngo.in,
 * .org.in, .res.in) plus the major foreign academic and government TLDs:
 *   - UK / Commonwealth: .ac.uk, .gov.uk
 *   - Australia / NZ:    .edu.au, .gov.au, .ac.nz
 *   - Japan / Korea:     .ac.jp, .ac.kr, .go.jp, .go.kr
 *   - South Asia:        .edu.bd, .gov.bd, .edu.lk, .gov.lk,
 *                        .edu.np, .gov.np, .edu.pk, .gov.pk-equivalent
 *   - SE Asia:           .edu.my, .gov.my, .edu.sg, .gov.sg,
 *                        .edu.ph, .gov.ph, .edu.tw
 *   - Greater China:     .edu.cn, .gov.cn (.gov.hk falls under .gov)
 *   - Africa:            .ac.za, .gov.za
 *   - Europe:            .gouv.fr (France), .bund.de (Germany federal)
 *   - Latin America:     .gob.ar, .gob.es, .gob.mx
 *   - Global:            .edu (US universities), .mil (US military),
 *                        .int (UN, WHO, IMF and other international orgs)
 *
 * Foreign institution gating: an Oxford or Harvard or UN domain hits the
 * institution OTP flow and creates an enterprise_inquiries row. The founder
 * sets the price manually before approval — Indian sub-type pricing
 * (₹999/₹2,999/₹4,999) does not apply to foreign institutions; they are
 * priced like a manual enterprise inquiry, currently quoted in INR but
 * PPP-adjusted pricing is on the v2 international rollout plan.
 *
 * Maintenance: alphabetical order on every addition. ICANN-recognised
 * second-level domains for institutional / governmental use only — do not
 * add commercial sub-TLDs (.co.uk, .com.au, etc.) here, those route through
 * GLOBAL_ENTERPRISE_DOMAINS or the page-count tier.
 */
export const INSTITUTION_TLDS = [
  '.ac.in',
  '.ac.jp',
  '.ac.kr',
  '.ac.nz',
  '.ac.uk',
  '.ac.za',
  '.bund.de',
  '.edu',
  '.edu.au',
  '.edu.bd',
  '.edu.cn',
  '.edu.in',
  '.edu.lk',
  '.edu.my',
  '.edu.np',
  '.edu.ph',
  '.edu.pk',
  '.edu.sg',
  '.edu.tw',
  '.go.jp',
  '.go.kr',
  '.gob.ar',
  '.gob.es',
  '.gob.mx',
  '.gouv.fr',
  '.gov',
  '.gov.au',
  '.gov.bd',
  '.gov.cn',
  '.gov.in',
  '.gov.lk',
  '.gov.my',
  '.gov.np',
  '.gov.ph',
  '.gov.sg',
  '.gov.uk',
  '.gov.za',
  '.int',
  '.mil',
  '.mil.in',
  '.ngo.in',
  '.org.in',
  '.res.in',
] as const
