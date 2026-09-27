export async function onRequest(context) {
  try {
    if (!context.env.DB) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "D1 database binding DB not found."
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    const result = await context.env.DB
      .prepare(`
        SELECT
          id,
          business_name,
          category,
          phone,
          whatsapp,
          city,
          address,
          description
        FROM businesses
        ORDER BY id DESC
      `)
      .all();

    return new Response(
      JSON.stringify({
        success: true,
        businesses: result.results || []
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "no-store"
        }
      }
    );

  } catch (error) {

    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
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
