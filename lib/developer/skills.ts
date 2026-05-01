/**
 * Skill checkboxes shown on the developer registration form.
 *
 * Order matters — most-commonly-picked options first so applicants see
 * their primary skill within the first row. Adding/removing entries is
 * safe (the DB column is text[]); just don't rename existing labels —
 * the lead matcher and admin filters key off these exact strings.
 *
 * Curated to match the universe of fixes a typical Bugbite scan
 * surfaces: WordPress + e-commerce dominate, then the modern JS stack,
 * then PHP/Node backends, mobile, payments + GBP for trust signals,
 * UI/UX for visual issues, hosting for SSL/server fixes.
 */
export const DEVELOPER_SKILLS = [
  'WordPress',
  'JavaScript / React / Next.js',
  'PHP / Laravel',
  'Shopify',
  'WooCommerce',
  'HTML/CSS',
  'Node.js / API dev',
  'WhatsApp API',
  'Razorpay / UPI integration',
  'Mobile apps (Flutter / React Native)',
  'SEO',
  'Google Business Profile / Local SEO',
  'UI/UX design',
  'Hosting / Server setup',
] as const

export type DeveloperSkill = (typeof DEVELOPER_SKILLS)[number]

/**
 * Years-of-experience picker. Stored as the lower bound of the bucket
 * (so "1–3 years" → 1) which keeps the column an int and lets the
 * admin panel sort/filter cleanly. Display labels stay friendly.
 */
export const YEARS_EXP_OPTIONS = [
  { value: 0, label: 'Less than 1 year' },
  { value: 1, label: '1 to 3 years' },
  { value: 3, label: '3 to 5 years' },
  { value: 5, label: '5 to 10 years' },
  { value: 10, label: '10+ years' },
] as const

export type YearsExpValue = (typeof YEARS_EXP_OPTIONS)[number]['value']
