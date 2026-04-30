import Razorpay from 'razorpay'
import { createHmac, timingSafeEqual } from 'node:crypto'

let _razorpay: Razorpay | null = null

/**
 * Razorpay SDK singleton. Lazy-initialized so importing this module does not
 * require env vars to be present at import time (useful for tests and for
 * Next.js routes whose bundling order is not guaranteed). Cached after first
 * call.
 */
export function getRazorpay(): Razorpay {
  if (_razorpay) return _razorpay
  const key_id = process.env.RAZORPAY_KEY_ID
  const key_secret = process.env.RAZORPAY_KEY_SECRET
  if (!key_id) throw new Error('RAZORPAY_KEY_ID is not set')
  if (!key_secret) throw new Error('RAZORPAY_KEY_SECRET is not set')
  _razorpay = new Razorpay({ key_id, key_secret })
  return _razorpay
}

/**
 * Verify the signature returned by Razorpay Checkout to the client after a
 * successful payment. The client POSTs { orderId, paymentId, signature } to
 * /api/payment/verify, which calls this function. Uses RAZORPAY_KEY_SECRET.
 *
 * Signed payload: `${orderId}|${paymentId}` (Razorpay-defined format).
 */
export function verifyCheckoutSignature(args: {
  orderId: string
  paymentId: string
  signature: string
}): boolean {
  const secret = process.env.RAZORPAY_KEY_SECRET
  if (!secret) throw new Error('RAZORPAY_KEY_SECRET is not set')
  const expected = createHmac('sha256', secret)
    .update(`${args.orderId}|${args.paymentId}`)
    .digest('hex')
  return safeCompare(expected, args.signature)
}

/**
 * Verify a webhook payload signature sent in the `x-razorpay-signature`
 * header. Uses RAZORPAY_WEBHOOK_SECRET (different from KEY_SECRET).
 *
 * IMPORTANT: pass the raw request body string. Parsing JSON and
 * re-stringifying will change byte-level content (key order, whitespace) and
 * the HMAC will not match. Read the body via `await req.text()` in the route
 * handler, verify, then `JSON.parse` only after verification passes.
 */
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET
  if (!secret) throw new Error('RAZORPAY_WEBHOOK_SECRET is not set')
  const expected = createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex')
  return safeCompare(expected, signature)
}

function safeCompare(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}
