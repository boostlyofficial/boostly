export async function onRequest(context) {

  try {

    const DB = context.env.DB;
    const method = context.request.method;

    // =====================================================
    // HELPER
    // =====================================================

    function json(data, status = 200) {

      return new Response(
        JSON.stringify(data),
        {
          status,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store"
          }
        }
      );

    }

    // =====================================================
    // GET = LOAD POSTS
    // =====================================================

    if (method === "GET") {

      const url =
        new URL(context.request.url);

      const businessId =
        url.searchParams.get("business_id");

      // ===================================================
      // CURRENT SESSION
      // ===================================================

      const cookieHeader =
        context.request.headers.get("Cookie") || "";

      const sessionMatch =
        cookieHeader.match(
          /(?:^|;\s*)boostly_session=([^;]+)/
        );

      const currentSessionId =
        sessionMatch
          ? sessionMatch[1]
          : "";

      // ===================================================
      // LOAD PUBLISHED POSTS
      // ===================================================

      let query = `
        SELECT
          p.id,
          p.business_id,
          p.post_type,
          p.media_type,
          p.media_url,
          p.thumbnail_url,
          p.public_id,
          p.caption,
          p.location,
          p.hashtags,
          p.likes_count,
          p.comments_count,
          p.shares_count,
          p.saves_count,
          p.views_count,
          p.status,
          p.created_at,
          p.updated_at,

          CASE
            WHEN EXISTS (
              SELECT 1
              FROM boost_post_likes l
              WHERE l.post_id = p.id
              AND l.user_id = (
                SELECT user_id
                FROM sessions
                WHERE id = ?
                AND expires_at > datetime('now')
                LIMIT 1
              )
            )
            THEN 1
            ELSE 0
          END AS liked,

          b.business_name,
          b.category,
          b.city

        FROM boost_posts p

        LEFT JOIN businesses b
          ON b.id = p.business_id

        WHERE p.status = 'published'
      `;

      const params = [
        currentSessionId
      ];

      // ===================================================
      // BUSINESS FILTER
      // ===================================================

      if (businessId) {

        const businessIdNumber =
          Number(businessId);

        if (
          !Number.isInteger(businessIdNumber) ||
          businessIdNumber <= 0
        ) {

          return json(
            {
              success: false,
              error: "Invalid business_id"
            },
            400
          );

        }

        query += `
          AND p.business_id = ?
        `;

        params.push(
          businessIdNumber
        );

      }

      // ===================================================
      // ORDER
      // ===================================================

      query += `
        ORDER BY p.created_at DESC
        LIMIT 100
      `;

      // ===================================================
      // RUN
      // ===================================================

      const result =
        await DB
          .prepare(query)
          .bind(...params)
          .all();

      // ===================================================
      // NORMALIZE
      // ===================================================

      const posts =
        (result.results || [])
          .map(function(post) {

            return {
              ...post,

              liked:
                Number(post.liked) === 1,

              likes_count:
                Number(post.likes_count || 0),

              comments_count:
                Number(post.comments_count || 0),

              shares_count:
                Number(post.shares_count || 0),

              saves_count:
                Number(post.saves_count || 0),

              views_count:
                Number(post.views_count || 0)

            };

          });

      return json({
        success: true,
        posts
      });

    }

    // =====================================================
    // ONLY POST AFTER THIS
    // =====================================================

    if (method !== "POST") {

      return json(
        {
          success: false,
          error:
            "Only GET and POST methods are allowed"
        },
        405
      );

    }

    // =====================================================
    // CHECK LOGIN
    // =====================================================

    const cookieHeader =
      context.request.headers.get("Cookie") || "";

    const sessionMatch =
      cookieHeader.match(
        /(?:^|;\s*)boostly_session=([^;]+)/
      );

    if (!sessionMatch) {

      return json(
        {
          success: false,
          error: "Not logged in"
        },
        401
      );

    }

    const sessionId =
      sessionMatch[1];

    // =====================================================
    // CHECK SESSION
    // =====================================================

    const session =
      await DB
        .prepare(`
          SELECT user_id
          FROM sessions
          WHERE id = ?
          AND expires_at > datetime('now')
          LIMIT 1
        `)
        .bind(sessionId)
        .first();

    if (!session) {

      return json(
        {
          success: false,
          error: "Session expired"
        },
        401
      );

    }

    // =====================================================
    // FORM DATA
    // =====================================================

    const formData =
      await context.request.formData();

    const action =
      String(
        formData.get("action") || "create"
      );

    // =====================================================
    // LIKE / UNLIKE
    // =====================================================

    if (
      action === "like" ||
      action === "unlike"
    ) {

      const postId =
        Number(
          formData.get("post_id")
        );

      // ===================================================
      // VALIDATE POST ID
      // ===================================================

      if (
        !Number.isInteger(postId) ||
        postId <= 0
      ) {

        return json(
          {
            success: false,
            error: "Invalid post_id"
          },
          400
        );

      }

      // ===================================================
      // CHECK POST
      // ===================================================

      const post =
        await DB
          .prepare(`
            SELECT
              id,
              likes_count
            FROM boost_posts
            WHERE id = ?
            AND status = 'published'
            LIMIT 1
          `)
          .bind(postId)
          .first();

      if (!post) {

        return json(
          {
            success: false,
            error: "Post not found"
          },
          404
        );

      }

      // ===================================================
      // LIKE
      // ===================================================

      if (action === "like") {

        const existingLike =
          await DB
            .prepare(`
              SELECT post_id
              FROM boost_post_likes
              WHERE post_id = ?
              AND user_id = ?
              LIMIT 1
            `)
            .bind(
              postId,
              session.user_id
            )
            .first();

        // -------------------------------------------------
        // ALREADY LIKED
        // -------------------------------------------------

        if (existingLike) {

          const currentPost =
            await DB
              .prepare(`
                SELECT likes_count
                FROM boost_posts
                WHERE id = ?
                LIMIT 1
              `)
              .bind(postId)
              .first();

          return json({
            success: true,
            liked: true,
            likes_count:
              Number(
                currentPost?.likes_count || 0
              )
          });

        }

        // -------------------------------------------------
        // INSERT LIKE
        // -------------------------------------------------

        const insertLike =
          await DB
            .prepare(`
              INSERT OR IGNORE INTO boost_post_likes
              (
                post_id,
                user_id
              )
              VALUES (?, ?)
            `)
            .bind(
              postId,
              session.user_id
            )
            .run();

        // -------------------------------------------------
        // ONLY INCREASE COUNT IF INSERT HAPPENED
        // -------------------------------------------------

        if (
          Number(
            insertLike?.meta?.changes || 0
          ) > 0
        ) {

          await DB
            .prepare(`
              UPDATE boost_posts
              SET
                likes_count =
                  COALESCE(likes_count, 0) + 1,
                updated_at =
                  datetime('now')
              WHERE id = ?
            `)
            .bind(postId)
            .run();

        }

        // -------------------------------------------------
        // UPDATED COUNT
        // -------------------------------------------------

        const updatedPost =
          await DB
            .prepare(`
              SELECT likes_count
              FROM boost_posts
              WHERE id = ?
              LIMIT 1
            `)
            .bind(postId)
            .first();

        return json({
          success: true,
          liked: true,
          likes_count:
            Number(
              updatedPost?.likes_count || 0
            ),
          message:
            "Post liked successfully"
        });

      }

      // ===================================================
      // UNLIKE
      // ===================================================

      if (action === "unlike") {

        const existingLike =
          await DB
            .prepare(`
              SELECT post_id
              FROM boost_post_likes
              WHERE post_id = ?
              AND user_id = ?
              LIMIT 1
            `)
            .bind(
              postId,
              session.user_id
            )
            .first();

        // -------------------------------------------------
        // NOT LIKED
        // -------------------------------------------------

        if (!existingLike) {

          const currentPost =
            await DB
              .prepare(`
                SELECT likes_count
                FROM boost_posts
                WHERE id = ?
                LIMIT 1
              `)
              .bind(postId)
              .first();

          return json({
            success: true,
            liked: false,
            likes_count:
              Number(
                currentPost?.likes_count || 0
              )
          });

        }

        // -------------------------------------------------
        // DELETE LIKE
        // -------------------------------------------------

        await DB
          .prepare(`
            DELETE FROM boost_post_likes
            WHERE post_id = ?
            AND user_id = ?
          `)
          .bind(
            postId,
            session.user_id
          )
          .run();

        // -------------------------------------------------
        // DECREASE COUNT
        // -------------------------------------------------

        await DB
          .prepare(`
            UPDATE boost_posts
            SET
              likes_count =
                CASE
                  WHEN COALESCE(likes_count, 0) > 0
                  THEN likes_count - 1
                  ELSE 0
                END,
              updated_at =
                datetime('now')
            WHERE id = ?
          `)
          .bind(postId)
          .run();

        // -------------------------------------------------
        // UPDATED COUNT
        // -------------------------------------------------

        const updatedPost =
          await DB
            .prepare(`
              SELECT likes_count
              FROM boost_posts
              WHERE id = ?
              LIMIT 1
            `)
            .bind(postId)
            .first();

        return json({
          success: true,
          liked: false,
          likes_count:
            Number(
              updatedPost?.likes_count || 0
            ),
          message:
            "Post unliked successfully"
        });

      }

    }

    // =====================================================
    // CREATE POST
    // =====================================================

    if (action !== "create") {

      return json(
        {
          success: false,
          error: "Invalid action"
        },
        400
      );

    }

    // =====================================================
    // CREATE POST DATA
    // =====================================================

    const businessId =
      formData.get("business_id");

    const postType =
      formData.get("post_type") || "post";

    const mediaType =
      formData.get("media_type");

    const mediaUrl =
      formData.get("media_url");

    const thumbnailUrl =
      formData.get("thumbnail_url") || "";

    const publicId =
      formData.get("public_id") || "";

    const caption =
      formData.get("caption") || "";

    const location =
      formData.get("location") || "";

    const hashtags =
      formData.get("hashtags") || "";

    // =====================================================
    // BASIC VALIDATION
    // =====================================================

    if (
      !businessId ||
      !mediaType ||
      !mediaUrl
    ) {

      return json(
        {
          success: false,
          error:
            "Business ID, media type or media URL missing"
        },
        400
      );

    }

    // =====================================================
    // POST TYPE
    // =====================================================

    if (
      postType !== "post" &&
      postType !== "reel"
    ) {

      return json(
        {
          success: false,
          error: "Invalid post type"
        },
        400
      );

    }

    // =====================================================
    // MEDIA TYPE
    // =====================================================

    if (
      mediaType !== "image" &&
      mediaType !== "video"
    ) {

      return json(
        {
          success: false,
          error: "Invalid media type"
        },
        400
      );

    }

    // =====================================================
    // BUSINESS ID
    // =====================================================

    const businessIdNumber =
      Number(businessId);

    if (
      !Number.isInteger(businessIdNumber) ||
      businessIdNumber <= 0
    ) {

      return json(
        {
          success: false,
          error: "Invalid business_id"
        },
        400
      );

    }

    // =====================================================
    // BUSINESS OWNERSHIP
    // =====================================================

    const business =
      await DB
        .prepare(`
          SELECT
            id,
            business_name
          FROM businesses
          WHERE id = ?
          AND user_id = ?
          LIMIT 1
        `)
        .bind(
          businessIdNumber,
          session.user_id
        )
        .first();

    if (!business) {

      return json(
        {
          success: false,
          error:
            "Business profile not found"
        },
        403
      );

    }

    // =====================================================
    // INSERT POST
    // =====================================================

    const insertResult =
      await DB
        .prepare(`
          INSERT INTO boost_posts
          (
            business_id,
            post_type,
            media_type,
            media_url,
            thumbnail_url,
            public_id,
            caption,
            location,
            hashtags,
            likes_count,
            comments_count,
            shares_count,
            saves_count,
            views_count,
            status,
            created_at,
            updated_at
          )
          VALUES
          (
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            0,
            0,
            0,
            0,
            0,
            'published',
            datetime('now'),
            datetime('now')
          )
        `)
        .bind(
          businessIdNumber,
          postType,
          mediaType,
          mediaUrl,
          thumbnailUrl,
          publicId,
          caption,
          location,
          hashtags
        )
        .run();

    // =====================================================
    // SUCCESS
    // =====================================================

    return json(
      {
        success: true,
        message:
          "Boost Post published successfully",
        post_id:
          insertResult.meta.last_row_id
      },
      201
    );

  } catch (error) {

    console.error(
      "boost-post API error:",
      error
    );

    return json(
      {
        success: false,
        error:
          error?.message ||
          "Server error"
      },
      500
    );

  }

}
