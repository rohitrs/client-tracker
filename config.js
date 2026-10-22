/*
 * Client Delivery Tracker — settings.
 *
 * Leave supabaseUrl / supabaseAnonKey empty to run in DEMO MODE
 * (data stays in your own browser only). Fill them in to share one
 * live tracker with your whole team — see README.md.
 */
window.TRACKER_CONFIG = {
  supabaseUrl: 'https://emdtklmdxsmonswtusvw.supabase.co',
  // The anon (public) key. Safe to publish: the database's security rules protect the data.
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVtZHRrbG1keHNtb25zd3R1c3Z3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2NDY4MDQsImV4cCI6MjEwODIyMjgwNH0.71qy9RT5Ok0LdgsT2TYKNatCBUVuROaPzSSN9ijWAW8',

  appName: 'Client Delivery Tracker',
  orgName: 'Supercharge Skills',
  program: 'Digital Transformation 2026',

  // People who can be picked in "Assigned to".
  team: ['Vikram', 'Surabhi', 'Paul', 'Zainab', 'Gayathri'],

  // The Digital Transformation 2026 package, broken into trackable deliverables.
  // Used by demo mode. In live mode the same list lives in the Supabase
  // "catalog" table (seeded by supabase/schema.sql) so you can edit it there.
  catalog: [
    { pillar: 'Unlock Your Niche', items: [
      { name: 'Ideal Audience & Zone of Genius' },
      { name: 'Positioning & Messaging' },
    ]},
    { pillar: 'Craft Your Signature Offer', items: [
      { name: 'Signature Program Design' },
      { name: 'Pricing, Structure & Bonuses' },
    ]},
    { pillar: 'Master the Latest AI Tools', items: [
      { name: 'AI Tools Training' },
    ]},
    { pillar: 'Build Your Brand Identity', items: [
      { name: 'Clarity Call' },
      { name: 'Logo', owner: 'Surabhi' },
      { name: 'Brand Colours & Font Kit', owner: 'Surabhi' },
      { name: 'Custom Visual Identity', owner: 'Surabhi' },
      { name: 'Tagline & Elevator Pitch' },
      { name: 'Bio (Instagram + Facebook)' },
    ]},
    { pillar: 'Launch Your Digital Home', items: [
      { name: 'Page Conversion Website', owner: 'Vikram' },
      { name: 'Domain Setup', owner: 'Vikram' },
      { name: 'Business Email ID Setup', owner: 'Vikram' },
    ]},
    { pillar: 'Dominate Social Media', items: [
      { name: 'Handle Setup (bio, highlights, links)' },
      { name: 'Reel 1', owner: 'Paul' },
      { name: 'Reel 2', owner: 'Paul' },
      { name: 'Reel 3', owner: 'Paul' },
      { name: 'Carousels', owner: 'Surabhi' },
      { name: 'Static Posts', owner: 'Surabhi' },
      { name: '30-day Content Calendar + Captions' },
    ]},
    { pillar: 'Shine on Video', items: [
      { name: 'Promo Video Script' },
      { name: 'Promo Video Shoot (guided)', owner: 'Paul' },
      { name: 'Promo Video Edit', owner: 'Paul' },
    ]},
    { pillar: 'Email & Lead Magnet System', items: [
      { name: 'Lead Magnet PDF', owner: 'Surabhi' },
      { name: 'Email Welcome Series' },
      { name: 'Newsletter Template' },
    ]},
    { pillar: 'World-Class Client Experience', items: [
      { name: 'Custom Portfolio' },
      { name: 'Invoicing Template' },
      { name: 'Discovery Call Script' },
      { name: 'Coaching Proposal Template' },
      { name: 'Digital Contract Template' },
    ]},
    { pillar: 'Bonuses', items: [
      { name: 'International Author System Access' },
      { name: 'Public Speaking Program Access' },
      { name: 'Discovery Call with Rohini Mundra' },
    ]},
  ],
};
