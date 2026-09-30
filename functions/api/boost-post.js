export async function onRequest(context) {

  try {

    // =====================================================
    // GET = LOAD POSTS
    // =====================================================

    if (context.request.method === "GET") {

      const url = new URL(context.request.url);

      const businessId =
        url.searchParams.get("business_id");


      // ===================================================
      // CHECK CURRENT LOGIN SESSION
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


      const params = [];


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

          return new Response(
            JSON.stringify({
              success: false,
              error: "Invalid business_id"
            }),
            {
              status: 400,
              headers: {
                "Content-Type": "application/json"
              }
            }
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
      // RUN QUERY
      // ===================================================

      const result =
        await context.env.DB
          .prepare(query)
          .bind(
            currentSessionId,
            ...params
          )
          .all();


      // ===================================================
      // RETURN POSTS
      // ===================================================

      return new Response(
        JSON.stringify({
          success: true,
          posts: result.results || []
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store"
          }
        }
      );

    }


    // =====================================================
    // ONLY POST AFTER THIS POINT
    // =====================================================

    if (context.request.method !== "POST") {

      return new Response(
        JSON.stringify({
          success: false,
          error:
            "Only GET and POST methods are allowed"
        }),
        {
          status: 405,
          headers: {
            "Content-Type": "application/json",
            "Allow": "GET, POST"
          }
        }
      );

    }


    // =====================================================
    // CHECK LOGIN SESSION
    // =====================================================

    const cookieHeader =
      context.request.headers.get("Cookie") || "";

    const match =
      cookieHeader.match(
        /(?:^|;\s*)boostly_session=([^;]+)/
      );


    if (!match) {

      return new Response(
        JSON.stringify({
          success: false,
          error: "Not logged in"
        }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );

    }


    const sessionId =
      match[1];


    // =====================================================
    // CHECK SESSION IN D1
    // =====================================================

    const session =
      await context.env.DB
        .prepare(`
          SELECT user_id
          FROM sessions
          WHERE id = ?
          AND expires_at > datetime('now')
        `)
        .bind(sessionId)
        .first();


    if (!session) {

      return new Response(
        JSON.stringify({
          success: false,
          error: "Session expired"
        }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );

    }


    // =====================================================
    // READ FORM DATA
    // =====================================================

    const formData =
      await context.request.formData();


    const action =
      formData.get("action") || "create";


    // =====================================================
    // LIKE / UNLIKE SYSTEM
    // =====================================================

    if (
      action === "like" ||
      action === "unlike"
    ) {

      const postIdValue =
        formData.get("post_id");


      const postId =
        Number(postIdValue);


      // ===================================================
      // VALIDATE POST ID
      // ===================================================

      if (
        !Number.isInteger(postId) ||
        postId <= 0
      ) {

        return new Response(
          JSON.stringify({
            success: false,
            error: "Invalid post_id"
          }),
          {
            status: 400,
            headers: {
              "Content-Type": "application/json"
            }
          }
        );

      }


      // ===================================================
      // CHECK POST EXISTS
      // ===================================================

      const post =
        await context.env.DB
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

        return new Response(
          JSON.stringify({
            success: false,
            error: "Post not found"
          }),
          {
            status: 404,
            headers: {
              "Content-Type": "application/json"
            }
          }
        );

      }


      // ===================================================
      // LIKE
      // ===================================================

      if (action === "like") {

        const existingLike =
          await context.env.DB
            .prepare(`
              SELECT
                post_id
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


        // Already liked
        if (existingLike) {

          return new Response(
            JSON.stringify({
              success: true,
              liked: true,
              likes_count:
                Number(
                  post.likes_count || 0
                ),
              message:
                "Post already liked"
            }),
            {
              status: 200,
              headers: {
                "Content-Type": "application/json"
              }
            }
          );

        }


        // =================================================
        // INSERT LIKE
        // =================================================

        await context.env.DB
          .prepare(`
            INSERT INTO boost_post_likes
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


        // =================================================
        // INCREASE LIKE COUNT
        // =================================================

        await context.env.DB
          .prepare(`
            UPDATE boost_posts
            SET
              likes_count =
                likes_count + 1,
              updated_at =
                datetime('now')
            WHERE id = ?
          `)
          .bind(postId)
          .run();


        // =================================================
        // GET UPDATED COUNT
        // =================================================

        const updatedPost =
          await context.env.DB
            .prepare(`
              SELECT
                likes_count
              FROM boost_posts
              WHERE id = ?
            `)
            .bind(postId)
            .first();


        return new Response(
          JSON.stringify({
            success: true,
            liked: true,
            likes_count:
              Number(
                updatedPost?.likes_count || 0
              ),
            message:
              "Post liked successfully"
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json"
            }
          }
        );

      }


      // ===================================================
      // UNLIKE
      // ===================================================

      if (action === "unlike") {

        const existingLike =
          await context.env.DB
            .prepare(`
              SELECT
                post_id
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


        // Already not liked
        if (!existingLike) {

          return new Response(
            JSON.stringify({
              success: true,
              liked: false,
              likes_count:
                Number(
                  post.likes_count || 0
                ),
              message:
                "Post is not liked"
            }),
            {
              status: 200,
              headers: {
                "Content-Type": "application/json"
              }
            }
          );

        }


        // =================================================
        // DELETE LIKE
        // =================================================

        await context.env.DB
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


        // =================================================
        // DECREASE LIKE COUNT SAFELY
        // =================================================

        await context.env.DB
          .prepare(`
            UPDATE boost_posts
            SET
              likes_count =
                CASE
                  WHEN likes_count > 0
                  THEN likes_count - 1
                  ELSE 0
                END,
              updated_at =
                datetime('now')
            WHERE id = ?
          `)
          .bind(postId)
          .run();


        // =================================================
        // GET UPDATED COUNT
        // =================================================

        const updatedPost =
          await context.env.DB
            .prepare(`
              SELECT
                likes_count
              FROM boost_posts
              WHERE id = ?
            `)
            .bind(postId)
            .first();


        return new Response(
          JSON.stringify({
            success: true,
            liked: false,
            likes_count:
              Number(
                updatedPost?.likes_count || 0
              ),
            message:
              "Post unliked successfully"
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json"
            }
          }
        );

      }

    }


    // =====================================================
    // CREATE BOOST POST
    // =====================================================

    if (action !== "create") {

      return new Response(
        JSON.stringify({
          success: false,
          error: "Invalid action"
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );

    }


    // =====================================================
    // READ CREATE POST DATA
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
    // VALIDATION
    // =====================================================

    if (
      !businessId ||
      !mediaType ||
      !mediaUrl
    ) {

      return new Response(
        JSON.stringify({
          success: false,
          error:
            "Business ID, media type or media URL missing"
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );

    }


    // =====================================================
    // VALID POST TYPE
    // =====================================================

    if (
      postType !== "post" &&
      postType !== "reel"
    ) {

      return new Response(
        JSON.stringify({
          success: false,
          error: "Invalid post type"
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );

    }


    // =====================================================
    // VALID MEDIA TYPE
    // =====================================================

    if (
      mediaType !== "image" &&
      mediaType !== "video"
    ) {

      return new Response(
        JSON.stringify({
          success: false,
          error: "Invalid media type"
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );

    }


    // =====================================================
    // BUSINESS ID VALIDATION
    // =====================================================

    const businessIdNumber =
      Number(businessId);


    if (
      !Number.isInteger(businessIdNumber) ||
      businessIdNumber <= 0
    ) {

      return new Response(
        JSON.stringify({
          success: false,
          error: "Invalid business_id"
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );

    }


    // =====================================================
    // CHECK BUSINESS OWNERSHIP
    // =====================================================

    const business =
      await context.env.DB
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

      return new Response(
        JSON.stringify({
          success: false,
          error:
            "Business profile not found"
        }),
        {
          status: 403,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );

    }


    // =====================================================
    // CREATE BOOST POST
    // =====================================================

    const insertResult =
      await context.env.DB
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

    return new Response(
      JSON.stringify({
        success: true,
        message:
          "Boost Post published successfully",
        post_id:
          insertResult.meta.last_row_id
      }),
      {
        status: 201,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );


  } catch (error) {

    console.error(error);


    return new Response(
      JSON.stringify({
        success: false,
        error:
          error.message ||
          "Server error"
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );

  }

}
