import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Supabase credentials not configured. Check SUPABASE_URL and SUPABASE_ANON_KEY in Vercel environment variables.');
  // Trim any accidental whitespace or trailing slashes
  const cleanUrl = url.trim().replace(/\/$/, '');
  const cleanKey = key.trim();
  return createClient(cleanUrl, cleanKey, {
    auth: { persistSession: false }
  });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  let supabase;
  try {
    supabase = getSupabase();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  const { action } = req.query;

  try {
    if (action === 'get_leads') {
      const { data, error } = await supabase
        .from('leads')
        .select(`*, touchpoints(*), responses(*)`)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return res.status(200).json({ leads: data });
    }

    if (action === 'save_lead') {
      const lead = req.body;
      const { error } = await supabase
        .from('leads')
        .upsert({
          id: lead.id,
          name: lead.name,
          address: lead.address,
          phone: lead.phone || null,
          website: lead.website || null,
          rating: lead.rating || null,
          review_count: lead.reviewCount || 0,
          has_no_reviews: lead.hasNoReviews || false,
          has_very_few_reviews: lead.hasVeryFewReviews || false,
          has_owner_responses: lead.hasOwnerResponses || false,
          desirability_score: lead.desirabilityScore || 0,
          distress_score: lead.distressScore || 0,
          density_score: lead.densityScore || 0,
          census_data: lead.censusData || null,
          zip_code: lead.zipCode || null,
          lat: lead.lat || null,
          lng: lead.lng || null,
          photos: lead.photos || [],
          reviews: lead.reviews || [],
        }, { onConflict: 'id' });
      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    if (action === 'delete_lead') {
      const { lead_id } = req.body;
      const { error } = await supabase.from('leads').delete().eq('id', lead_id);
      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    if (action === 'add_touchpoint') {
      const { lead_id, touch_number, contact_type, sent_date, letter_template, notes } = req.body;
      const { error } = await supabase
        .from('touchpoints')
        .insert({ lead_id, touch_number, contact_type, sent_date, letter_template: letter_template || null, notes: notes || null });
      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    if (action === 'delete_touchpoint') {
      const { id } = req.body;
      const { error } = await supabase.from('touchpoints').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    if (action === 'add_response') {
      const { lead_id, response_date, responder, sentiment, notes } = req.body;
      const { error } = await supabase
        .from('responses')
        .insert({ lead_id, response_date, responder: responder || 'Owner', sentiment, notes: notes || null });
      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    if (action === 'delete_response') {
      const { id } = req.body;
      const { error } = await supabase.from('responses').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    return res.status(400).json({ error: 'Unknown action: ' + action });

  } catch (err) {
    console.error('CRM error:', err);
    return res.status(500).json({ error: err.message });
  }
}
