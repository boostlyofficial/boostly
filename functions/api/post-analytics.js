export async function onRequestGet(context) {
const { request, env } = context;

const json = (data, status = 200) =>
new Response(JSON.stringify(data), {
status,
headers: {
"Content-Type": "application/json; charset=utf-8",
"Cache-Control": "no-store"
}
});

try {
if (!env.DB) {
return json({
success: false,
error: "Database unavailable"
}, 500);
}

// 1. Verify login session
const cookie = request.headers.get("Cookie") || "";
const match = cookie.match(
  /(?:^|;\s*)boostly_session=([^;]+)/
);

if (!match) {
  return json({
    success: false,
    error: "Not logged in"
  }, 401);
}

const session = await env.DB.prepare(`
  SELECT user_id
  FROM sessions
  WHERE id = ?
    AND expires_at > datetime('now')
  LIMIT 1
`).bind(match[1]).first();

if (!session) {
  return json({
    success: false,
    error: "Session expired"
  }, 401);
}

// 2. Load this user's businesses
const businessesResult = await env.DB.prepare(`
  SELECT id, business_name, category, city
  FROM businesses
  WHERE user_id = ?
  ORDER BY id DESC
`).bind(session.user_id).all();

const businesses = businessesResult.results || [];

if (!businesses.length) {
  return json({
    success: true,
    businesses: [],
    posts: [],
    summary: {
      total_posts: 0,
      total_likes: 0,
      total_comments: 0,
      total_shares: 0,
      total_saves: 0,
      total_views: 0
    }
  });
}

// 3. Optional business filter
const url = new URL(request.url);
const rawBusinessId = url.searchParams.get("business_id");
let businessId = null;

if (rawBusinessId !== null) {
  businessId = Number(rawBusinessId);

  if (!Number.isInteger(businessId) || businessId <= 0) {
    return json({
      success: false,
      error: "Invalid business_id"
    }, 400);
  }

  const ownedBusiness = businesses.some(
    business => Number(business.id) === businessId
  );

  if (!ownedBusiness) {
    return json({
      success: false,
      error: "Business not found or access denied"
    }, 403);
  }
}

// 4. Load posts belonging only to this user
let sql = `
  SELECT
    p.id,
    p.business_id,
    p.post_type,
    p.media_type,
    p.media_url,
    p.thumbnail_url,
    p.caption,
    p.location,
    p.hashtags,
    p.likes_count,
    p.comments_count,
    p.shares_count,
    (
      SELECT COUNT(*)
      FROM boost_post_saves s
      WHERE s.post_id = p.id
    ) AS saves_count,
    p.views_count,
    p.status,
    p.created_at,
    p.updated_at,
    b.business_name,
    b.category,
    b.city
  FROM boost_posts p
  INNER JOIN businesses b
    ON b.id = p.business_id
  WHERE b.user_id = ?
`;

const params = [session.user_id];

if (businessId !== null) {
  sql += " AND p.business_id = ?";
  params.push(businessId);
}

sql += " ORDER BY p.created_at DESC LIMIT 500";

const result = await env.DB
  .prepare(sql)
  .bind(...params)
  .all();

const posts = (result.results || []).map(post => ({
  ...post,
  likes_count: Number(post.likes_count || 0),
  comments_count: Number(post.comments_count || 0),
  shares_count: Number(post.shares_count || 0),
  saves_count: Number(post.saves_count || 0),
  views_count: Number(post.views_count || 0)
}));

// 5. Calculate totals
const summary = posts.reduce((total, post) => {
  total.total_likes += post.likes_count;
  total.total_comments += post.comments_count;
  total.total_shares += post.shares_count;
  total.total_saves += post.saves_count;
  total.total_views += post.views_count;
  return total;
}, {
  total_posts: posts.length,
  total_likes: 0,
  total_comments: 0,
  total_shares: 0,
  total_saves: 0,
  total_views: 0
});

// 6. Return analytics data
return json({
  success: true,
  businesses,
  summary,
  posts
});

} catch (error) {
console.error("Post Analytics API error:", error);

return json({
  success: false,
  error: "Unable to load post analytics"
}, 500);

}
}
