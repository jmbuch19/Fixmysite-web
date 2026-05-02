/**
 * Question definitions for the Blueprint wizard. Data-driven so the UI
 * stays a single rendering primitive across all 7 branches — adding a
 * new question or option is a constant edit, not a JSX patch.
 *
 * Branch 2 is dynamic: which set of questions appears depends on the
 * Branch 1 answer. `getBranch2Questions(businessType)` resolves the
 * right set; creative + unsure fall through to the service path
 * because they're the most flexible questions and apply broadly.
 *
 * Answer storage is keyed by question.id — wizard state is a single
 * Record<string, string | string[]> that grows as the owner advances.
 */

// ─── Business types (Branch 1) ─────────────────────────────────────────

export const BUSINESS_TYPES = [
  {
    value: 'physical',
    label: 'Physical business (shop, clinic, office, studio)',
  },
  {
    value: 'service',
    label: 'Service provider (consultant, trainer, freelancer)',
  },
  {
    value: 'product',
    label: 'Product seller (manufacturer, trader, retailer)',
  },
  { value: 'institution', label: 'Institution (school, NGO, trust, society)' },
  {
    value: 'creative',
    label: 'Creative practice (artist, writer, musician, chef)',
  },
  { value: 'unsure', label: 'Just starting — not sure yet' },
] as const

export type BusinessType = (typeof BUSINESS_TYPES)[number]['value']

// ─── Question primitives ───────────────────────────────────────────────

export type RadioQuestion = {
  kind: 'radio'
  id: string
  label: string
  options: ReadonlyArray<{ value: string; label: string }>
  // Optional follow-up text input shown when a specific option is picked.
  followUp?: { triggerValue: string; placeholder: string; optional?: boolean }
}

export type CheckboxQuestion = {
  kind: 'checkbox'
  id: string
  label: string
  helper?: string
  options: ReadonlyArray<{ value: string; label: string }>
  minSelected?: number
}

export type TextQuestion = {
  kind: 'text'
  id: string
  label: string
  placeholder?: string
  maxLength?: number
}

export type TextAreaQuestion = {
  kind: 'textarea'
  id: string
  label: string
  placeholder?: string
  helper?: string
  examples?: string[]
  rows?: number
  maxLength?: number
}

export type EmailQuestion = {
  kind: 'email'
  id: string
  label: string
  helper?: string
  placeholder?: string
}

export type Question =
  | RadioQuestion
  | CheckboxQuestion
  | TextQuestion
  | TextAreaQuestion
  | EmailQuestion

// ─── Branch 1 ──────────────────────────────────────────────────────────

export const BRANCH_1: { title: string; questions: Question[] } = {
  title: 'What kind of business is this?',
  questions: [
    {
      kind: 'radio',
      id: 'business_type',
      label: 'What best describes your business?',
      options: BUSINESS_TYPES.map(({ value, label }) => ({ value, label })),
    },
  ],
}

// ─── Branch 2 — varies by Branch 1 ─────────────────────────────────────

const BRANCH_2_PHYSICAL: Question[] = [
  {
    kind: 'radio',
    id: 'customers_per_month',
    label: 'How many customers visit you per month?',
    options: [
      { value: 'under_50', label: 'Under 50' },
      { value: '50_200', label: '50–200' },
      { value: '200_1000', label: '200–1,000' },
      { value: '1000_plus', label: '1,000+' },
    ],
  },
  {
    kind: 'radio',
    id: 'found_via_google',
    label: 'Do customers currently find you via Google search?',
    options: [
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'No' },
      { value: 'dont_know', label: "I don't know" },
    ],
  },
  {
    kind: 'radio',
    id: 'takes_appointments',
    label: 'Do you take appointments or bookings?',
    options: [
      { value: 'call_to_book', label: 'Yes — customers call to book' },
      { value: 'walk_in', label: 'Yes — walk-in only' },
      { value: 'not_applicable', label: 'No — not applicable' },
    ],
  },
]

const BRANCH_2_SERVICE: Question[] = [
  {
    kind: 'radio',
    id: 'client_location',
    label: 'Do you work with clients locally or remotely?',
    options: [
      { value: 'local_only', label: 'Local only' },
      { value: 'mix', label: 'Mix of local and remote' },
      { value: 'fully_remote', label: 'Fully remote / anywhere in India' },
      { value: 'international', label: 'International clients' },
    ],
  },
  {
    kind: 'radio',
    id: 'current_acquisition',
    label: 'How do you currently get new clients?',
    options: [
      { value: 'word_of_mouth', label: 'Word of mouth only' },
      { value: 'social_media', label: 'Social media' },
      {
        value: 'platforms',
        label: 'Existing platforms (Upwork, Fiverr, etc.)',
      },
      {
        value: 'struggle',
        label: "I struggle to get clients — that's the problem",
      },
    ],
  },
]

const BRANCH_2_PRODUCT: Question[] = [
  {
    kind: 'radio',
    id: 'product_count',
    label: 'How many products do you sell?',
    options: [
      { value: 'under_20', label: 'Under 20' },
      { value: '20_100', label: '20–100' },
      { value: '100_500', label: '100–500' },
      { value: '500_plus', label: '500+' },
    ],
  },
  {
    kind: 'radio',
    id: 'sells_online',
    label: 'Do you currently sell online?',
    options: [
      { value: 'no', label: 'No — everything offline' },
      { value: 'whatsapp', label: 'Yes — via WhatsApp' },
      {
        value: 'marketplace',
        label: 'Yes — via Amazon / Flipkart / marketplace',
      },
      { value: 'basic_site', label: 'Yes — I have a basic site already' },
    ],
  },
  {
    kind: 'radio',
    id: 'accounts_needed',
    label: 'Do customers need accounts to track orders?',
    options: [
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'No' },
      { value: 'not_sure', label: 'Not sure' },
    ],
  },
]

const BRANCH_2_INSTITUTION: Question[] = [
  {
    kind: 'radio',
    id: 'institution_type',
    label: 'What does your institution do?',
    options: [
      { value: 'education', label: 'Education (school, college, coaching)' },
      { value: 'ngo', label: 'Non-profit / NGO / trust' },
      { value: 'religious', label: 'Religious / cultural organisation' },
      { value: 'healthcare', label: 'Healthcare institution' },
      { value: 'other', label: 'Other' },
    ],
    followUp: {
      triggerValue: 'other',
      placeholder: 'Tell us in a few words…',
    },
  },
  {
    kind: 'radio',
    id: 'online_donations',
    label: 'Do you need to collect donations or fees online?',
    options: [
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'No' },
      { value: 'maybe_later', label: 'Maybe later' },
    ],
  },
  {
    kind: 'radio',
    id: 'publishes_content',
    label: 'Do you publish regular content (events, news, notices)?',
    options: [
      { value: 'frequently', label: 'Yes — frequently' },
      { value: 'occasionally', label: 'Occasionally' },
      { value: 'no', label: 'No' },
    ],
  },
]

/**
 * Resolve Branch 2 questions for a given Branch 1 answer.
 * Creative + unsure fall through to the service path because those
 * questions (client location, current acquisition) are the most
 * broadly applicable. The SPEC doesn't define dedicated branches for
 * either; this is an explicit v1 default we can revisit.
 */
export function getBranch2(businessType: BusinessType | undefined): {
  title: string
  questions: Question[]
} {
  switch (businessType) {
    case 'physical':
      return { title: 'About your business', questions: BRANCH_2_PHYSICAL }
    case 'product':
      return {
        title: 'About what you sell',
        questions: BRANCH_2_PRODUCT,
      }
    case 'institution':
      return {
        title: 'About your institution',
        questions: BRANCH_2_INSTITUTION,
      }
    case 'service':
    case 'creative':
    case 'unsure':
    default:
      return { title: 'About your work', questions: BRANCH_2_SERVICE }
  }
}

// ─── Branch 3 ──────────────────────────────────────────────────────────

export const BRANCH_3: { title: string; questions: Question[] } = {
  title: 'Scale of your business',
  questions: [
    {
      kind: 'radio',
      id: 'monthly_turnover',
      label: 'Approximate monthly turnover?',
      options: [
        { value: 'pre_revenue', label: 'Pre-revenue / just starting' },
        { value: 'under_1l', label: 'Under ₹1 lakh' },
        { value: '1_5l', label: '₹1–5 lakh' },
        { value: '5_20l', label: '₹5–20 lakh' },
        { value: '20l_plus', label: '₹20 lakh+' },
        { value: 'prefer_not_to_say', label: 'Prefer not to say' },
      ],
    },
    {
      kind: 'radio',
      id: 'team_size',
      label: 'How many people work in your business?',
      options: [
        { value: 'just_me', label: 'Just me' },
        { value: '2_5', label: '2–5 people' },
        { value: '6_20', label: '6–20 people' },
        { value: '20_plus', label: 'More than 20' },
      ],
    },
  ],
}

// ─── Branch 4 ──────────────────────────────────────────────────────────

export const BRANCH_4: { title: string; questions: Question[] } = {
  title: 'What you want from a website',
  questions: [
    {
      kind: 'checkbox',
      id: 'website_goals',
      label: 'What do you want a website to do for you?',
      helper: 'Tick all that apply.',
      minSelected: 1,
      options: [
        { value: 'google_findable', label: 'Help new customers find me on Google' },
        {
          value: 'show_work',
          label: 'Show my work / portfolio / products / menu',
        },
        {
          value: 'contactable',
          label: 'Let customers contact or book me without calling',
        },
        { value: 'accept_payments', label: 'Accept payments online' },
        { value: 'build_trust', label: 'Build trust — look professional' },
        {
          value: 'sell_directly',
          label: 'Sell products directly (e-commerce)',
        },
        { value: 'collect_leads', label: 'Collect leads / enquiries' },
        {
          value: 'reduce_whatsapp',
          label: 'Reduce my dependency on WhatsApp for business',
        },
      ],
    },
    {
      kind: 'radio',
      id: 'success_in_6_months',
      label: 'What does success look like in 6 months?',
      options: [
        { value: 'more_calls', label: 'More phone calls from new customers' },
        {
          value: 'auto_bookings',
          label: 'Online bookings without me being involved',
        },
        { value: 'direct_sales', label: 'Direct online sales' },
        {
          value: 'google_visible',
          label: 'Being found on Google for my service',
        },
        {
          value: 'professional_pricing',
          label: 'Looking professional enough to charge more',
        },
        { value: 'unsure', label: "I honestly don't know yet" },
      ],
    },
  ],
}

// ─── Branch 5 ──────────────────────────────────────────────────────────

export const BRANCH_5: { title: string; questions: Question[] } = {
  title: 'Where your customers are',
  questions: [
    {
      kind: 'radio',
      id: 'customer_geography',
      label: 'Where are your customers?',
      options: [
        { value: 'one_city', label: 'One city only' },
        { value: 'one_state', label: 'Multiple cities in one state' },
        { value: 'pan_india', label: 'Pan-India' },
        { value: 'international', label: 'International' },
        { value: 'mix', label: 'Mix of local and national' },
      ],
    },
    {
      kind: 'radio',
      id: 'language_needs',
      label: 'Do you need the website in multiple languages?',
      options: [
        { value: 'english_only', label: 'English only is fine' },
        {
          value: 'hindi_or_gujarati',
          label: 'Hindi or Gujarati also needed',
        },
        { value: 'regional_primary', label: 'Regional language primarily' },
        { value: 'multiple', label: 'Multiple languages needed' },
      ],
    },
  ],
}

// ─── Branch 6 ──────────────────────────────────────────────────────────

export const BRANCH_6: { title: string; questions: Question[] } = {
  title: 'Practical reality',
  questions: [
    {
      kind: 'radio',
      id: 'prior_website_attempts',
      label: 'Have you tried building a website before?',
      options: [
        { value: 'never', label: 'Never tried' },
        { value: 'tried_stopped', label: 'Tried — got confused and stopped' },
        {
          value: 'lost_access',
          label: "Had one built — don't have access to it",
        },
        { value: 'unhappy', label: 'Have one — not happy with it' },
      ],
    },
    {
      kind: 'radio',
      id: 'domain_status',
      label: 'Do you have a domain name?',
      options: [
        { value: 'have', label: 'Yes' },
        { value: 'name_in_mind', label: 'No — have a name in mind' },
        { value: 'need_help', label: 'No — need help choosing' },
      ],
      followUp: {
        triggerValue: 'have',
        placeholder: 'yourbusiness.com',
        optional: true,
      },
    },
    {
      kind: 'radio',
      id: 'logo_status',
      label: 'Do you have a logo?',
      options: [
        { value: 'professional', label: 'Yes — professionally designed' },
        {
          value: 'self_made',
          label: 'Yes — made myself (WhatsApp DP etc.)',
        },
        { value: 'none', label: 'No logo yet' },
      ],
    },
    {
      kind: 'radio',
      id: 'budget',
      label: 'Budget for the website?',
      options: [
        { value: 'under_5k', label: 'Under ₹5,000 (basic only)' },
        {
          value: '5k_20k',
          label: '₹5,000–₹20,000 (proper small business site)',
        },
        {
          value: '20k_1l',
          label: '₹20,000–₹1,00,000 (serious investment)',
        },
        { value: 'above_1l', label: 'Above ₹1 lakh (custom / complex)' },
        {
          value: 'depends',
          label: 'Not sure — depends on what I need',
        },
      ],
    },
    {
      kind: 'radio',
      id: 'timeline',
      label: 'Timeline?',
      options: [
        { value: 'urgent', label: 'This week — urgent' },
        { value: 'within_month', label: 'Within a month' },
        { value: 'no_rush', label: 'No rush — get it right' },
        { value: 'exploring', label: 'Just exploring for now' },
      ],
    },
  ],
}

// ─── Branch 7 — Open question + contact ───────────────────────────────
//
// Two fields: the open free-text from SPEC §20 plus an owner_email
// capture. Email is required because the success card and Session 2's
// blueprint-ready notification both depend on it. Capturing here at
// the natural end of the flow (rather than upfront) keeps the wizard
// feeling like a conversation, not a form.

export const BRANCH_7: { title: string; questions: Question[] } = {
  title: 'In your own words',
  questions: [
    {
      kind: 'textarea',
      id: 'free_text',
      label:
        'Tell us about your business in your own words. What do you do, who are your customers, and what is the one thing you most want your website to do for you?',
      placeholder: 'Any language. Any length.',
      helper:
        'Write in English, Hindi, Gujarati, or mixed — Bugbite reads them all.',
      examples: [
        '"Maro kapda no business 6e. Customer Instagram thi aave 6e pan website nathi. Hu chahun 6u ke online order pan aave."',
        '"I am a CA in Pune. Clients come via referrals only. I want a site that looks professional when they Google me."',
        '"NGO for blind children in Hyderabad. Need donation button."',
      ],
      rows: 6,
      maxLength: 5000,
    },
    {
      kind: 'email',
      id: 'owner_email',
      label: 'Where should Bugbite send your blueprint?',
      placeholder: 'you@yourbusiness.com',
      helper:
        "Bugbite emails you the link as soon as your full blueprint is ready. We never send marketing — just your blueprint and any updates to it.",
    },
  ],
}

// ─── Step plan ─────────────────────────────────────────────────────────

export const TOTAL_STEPS = 7
