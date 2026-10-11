export async function onRequest(context) {
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
      return json({ success: false, error: "Database unavailable." }, 500);
    }

    const cookie = request.headers.get("Cookie") || "";
    const match = cookie.match(/(?:^|;\s*)boostly_session=([^;]+)/);

    if (!match) {
      return json({
        success: false,
        error: "Please log in before creating a creator profile."
      }, 401);
    }

    const session = await env.DB.prepare(`
      SELECT user_id
      FROM sessions
      WHERE id = ? AND expires_at > datetime('now')
      LIMIT 1
    `).bind(match[1]).first();

    if (!session || !session.user_id) {
      return json({
        success: false,
        error: "Your session expired. Please log in again."
      }, 401);
    }

    if (request.method === "GET") {
      const profile = await env.DB.prepare(`
        SELECT id, creator_name, creator_handle, category, bio,
               city, instagram_url, youtube_url, profile_image,
               status, created_at
        FROM creators
        WHERE user_id = ?
        LIMIT 1
      `).bind(session.user_id).first();

      return json({ success: true, profile: profile || null });
    }

    if (request.method !== "POST") {
      return json({ success: false, error: "Method not allowed." }, 405);
    }

    let body;

    try {
      body = await request.json();
    } catch {
      return json({ success: false, error: "Invalid JSON body." }, 400);
    }

    const creatorName = String(body.creator_name || "").trim();
    const creatorHandle = String(body.creator_handle || "")
      .trim()
      .replace(/^@+/, "");
    const category = String(body.category || "").trim();
    const bio = String(body.bio || "").trim();
    const city = String(body.city || "").trim();
    const instagramUrl = String(body.instagram_url || "").trim();
    const youtubeUrl = String(body.youtube_url || "").trim();
    const profileImage = String(body.profile_image || "").trim();

    if (!creatorName || !creatorHandle || !category) {
      return json({
        success: false,
        error: "Creator name, handle and category are required."
      }, 400);
    }

    if (
      creatorName.length > 80 ||
      creatorHandle.length > 50 ||
      category.length > 40 ||
      bio.length > 500 ||
      city.length > 80 ||
      instagramUrl.length > 300 ||
      youtubeUrl.length > 300 ||
      profileImage.length > 1000
    ) {
      return json({
        success: false,
        error: "One or more fields exceed the allowed length."
      }, 400);
    }

    const validUrl = value => {
      if (!value) return true;
      try {
        const url = new URL(value);
        return url.protocol === "https:" || url.protocol === "http:";
      } catch {
        return false;
      }
    };

    if (
      !validUrl(instagramUrl) ||
      !validUrl(youtubeUrl) ||
      !validUrl(profileImage)
    ) {
      return json({
        success: false,
        error: "Social links and profile image must be valid HTTP or HTTPS URLs."
      }, 400);
    }

    await env.DB.prepare(`
      INSERT INTO creators (
        user_id, creator_name, creator_handle, category, bio,
        city, instagram_url, youtube_url, profile_image, status
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
      ON CONFLICT(user_id) DO UPDATE SET
        creator_name = excluded.creator_name,
        creator_handle = excluded.creator_handle,
        category = excluded.category,
        bio = excluded.bio,
        city = excluded.city,
        instagram_url = excluded.instagram_url,
        youtube_url = excluded.youtube_url,
        profile_image = excluded.profile_image
    `).bind(
      session.user_id,
      creatorName,
      creatorHandle,
      category,
      bio,
      city,
      instagramUrl,
      youtubeUrl,
      profileImage
    ).run();

    const profile = await env.DB.prepare(`
      SELECT id, creator_name, creator_handle, category, bio,
             city, instagram_url, youtube_url, profile_image,
             status, created_at
      FROM creators
      WHERE user_id = ?
      LIMIT 1
    `).bind(session.user_id).first();

    return json({
      success: true,
      message: "Creator profile saved successfully.",
      profile
    });
  } catch (error) {
    if (String(error.message || "").toLowerCase().includes("unique")) {
      return json({
        success: false,
        error: "This creator handle is already in use. Choose another."
      }, 409);
    }

    return json({
      success: false,
      error: "Could not save creator profile. Please try again."
    }, 500);
  }
}
