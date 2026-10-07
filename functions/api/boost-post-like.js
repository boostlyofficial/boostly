export async function onRequest() {
  return new Response(
    JSON.stringify({
      success: false,
      error: "This API endpoint is not used. Use /api/boost-post instead."
    }),
    {
      status: 404,
      headers: {
        "Content-Type": "application/json"
      }
    }
  );
}
