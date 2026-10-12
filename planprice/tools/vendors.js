/* Shared vendor directory for the PlanPrice pricing tools.
   Used by tools/deal-verifier.html, tools/renewal-hike-checker.html and
   tools/fee-decoder.html. Regenerate from data/deals-index.json.
   priceSort is the verified starting monthly figure (null for
   quote-based pricing); priceText is the matching label.
   FIXTURE — editorial, verify before launch. */
var VENDORS = [
  {slug:"hubspot",name:"HubSpot",category:"CRM & Marketing",catSlug:"crm-marketing",priceSort:0,priceText:"From $0 free"},
  {slug:"freshbooks",name:"FreshBooks",category:"Accounting",catSlug:"accounting",priceSort:26,priceText:"From C$26 per month"},
  {slug:"monday",name:"Monday.com",category:"Work Management",catSlug:"work-management",priceSort:0,priceText:"From $0 free"},
  {slug:"semrush",name:"Semrush",category:"SEO & Marketing",catSlug:"seo-marketing",priceSort:139.95,priceText:"From $139.95 per month"},
  {slug:"shopify",name:"Shopify",category:"Ecommerce",catSlug:"ecommerce",priceSort:5,priceText:"From $5 per month"},
  {slug:"wave",name:"Wave",category:"Accounting",catSlug:"accounting",priceSort:0,priceText:"From $0 free"},
  {slug:"quickbooks",name:"QuickBooks Online",category:"Accounting",catSlug:"accounting",priceSort:30,priceText:"From C$30 per month"},
  {slug:"xero",name:"Xero",category:"Accounting",catSlug:"accounting",priceSort:25,priceText:"From $25 per month"},
  {slug:"square",name:"Square",category:"Payments & POS",catSlug:"payments-pos",priceSort:0,priceText:"From $0 free"},
  {slug:"calendly",name:"Calendly",category:"Scheduling",catSlug:"scheduling",priceSort:0,priceText:"From $0 free"},
  {slug:"jobber",name:"Jobber",category:"Field Service",catSlug:"field-service",priceSort:49,priceText:"From C$49 per month"},
  {slug:"humi",name:"Humi",category:"HR & Payroll",catSlug:"hr-payroll",priceSort:null,priceText:"Custom"},
  {slug:"ahrefs",name:"Ahrefs",category:"SEO & Marketing",catSlug:"seo-marketing",priceSort:29,priceText:"From $29 per month"},
  {slug:"plausible",name:"Plausible",category:"SEO & Marketing",catSlug:"seo-marketing",priceSort:9,priceText:"From $9 per month"},
  {slug:"stripe",name:"Stripe",category:"Payments & POS",catSlug:"payments-pos",priceSort:null,priceText:"From 2.9% + 30¢ per transaction"},
  {slug:"big-cartel",name:"Big Cartel",category:"Ecommerce",catSlug:"ecommerce",priceSort:0,priceText:"From $0 free"},
  {slug:"pipedrive",name:"Pipedrive",category:"CRM & Marketing",catSlug:"crm-marketing",priceSort:14,priceText:"From $14 per user/month"},
  {slug:"zoho-crm",name:"Zoho CRM",category:"CRM & Marketing",catSlug:"crm-marketing",priceSort:0,priceText:"From $0 free"},
  {slug:"wagepoint",name:"Wagepoint",category:"HR & Payroll",catSlug:"hr-payroll",priceSort:20,priceText:"From C$20 per month"},
  {slug:"knit-people",name:"Knit People",category:"HR & Payroll",catSlug:"hr-payroll",priceSort:39,priceText:"From C$39 per month"},
  {slug:"acuity",name:"Acuity Scheduling",category:"Scheduling",catSlug:"scheduling",priceSort:20,priceText:"From $20 per month"},
  {slug:"setmore",name:"Setmore",category:"Scheduling",catSlug:"scheduling",priceSort:0,priceText:"From $0 free"}
];

/* Per-page projection for fee-decoder: [slug, name] pairs, same order. */
var VENDOR_NAMES = VENDORS.map(function(v) { return [v.slug, v.name]; });
