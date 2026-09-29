<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">

<title>Boost Feed | Boostly</title>

<style>
*{
  box-sizing:border-box;
  margin:0;
  padding:0;
}

body{
  font-family:Arial,Helvetica,sans-serif;
  background:#f5f3f8;
  color:#18131f;
}

.header{
  position:sticky;
  top:0;
  z-index:50;
  background:#fff;
  border-bottom:1px solid #e9e3ef;
}

.header-inner{
  max-width:850px;
  margin:auto;
  padding:14px 16px;
  display:flex;
  align-items:center;
  justify-content:space-between;
}

.logo{
  color:#6d3df5;
  font-size:24px;
  font-weight:800;
  text-decoration:none;
}

.back{
  text-decoration:none;
  color:#555;
  font-size:14px;
  font-weight:700;
}

.container{
  max-width:700px;
  margin:25px auto;
  padding:0 12px;
}

.page-title{
  text-align:center;
  margin-bottom:22px;
}

.page-title h1{
  font-size:29px;
  margin-bottom:7px;
}

.page-title p{
  color:#777;
  font-size:14px;
}

.status{
  text-align:center;
  padding:20px;
  color:#777;
}

.post{
  background:#fff;
  border:1px solid #e8e1ef;
  border-radius:18px;
  margin-bottom:22px;
  overflow:hidden;
  box-shadow:0 8px 25px rgba(30,15,50,.06);
}

.post-header{
  padding:15px;
  display:flex;
  align-items:center;
  gap:11px;
}

.business-avatar{
  width:44px;
  height:44px;
  border-radius:50%;
  background:linear-gradient(135deg,#6d3df5,#a98cff);
  color:#fff;
  display:flex;
  align-items:center;
  justify-content:center;
  font-size:18px;
  font-weight:800;
}

.business-info{
  flex:1;
}

.business-name{
  font-weight:800;
  font-size:15px;
}

.business-meta{
  color:#888;
  font-size:12px;
  margin-top:3px;
}

.post-type{
  font-size:11px;
  background:#f1ebff;
  color:#6034cf;
  padding:6px 9px;
  border-radius:20px;
  font-weight:700;
}

.media{
  width:100%;
  background:#111;
}

.media img,
.media video{
  width:100%;
  max-height:650px;
  display:block;
  object-fit:contain;
  background:#111;
}

.post-content{
  padding:15px;
}

.actions{
  display:flex;
  gap:9px;
  margin-bottom:13px;
}

.action-btn{
  border:1px solid #e2dce8;
  background:#fff;
  border-radius:10px;
  padding:9px 12px;
  cursor:pointer;
  font-size:13px;
  font-weight:700;
}

.action-btn:hover{
  background:#f7f3fc;
}

.caption{
  font-size:14px;
  line-height:1.5;
  margin-bottom:8px;
}

.hashtags{
  color:#6d3df5;
  font-size:13px;
  line-height:1.5;
}

.location{
  color:#777;
  font-size:12px;
  margin-top:9px;
}

.stats{
  color:#888;
  font-size:12px;
  margin-top:12px;
}

.empty{
  background:#fff;
  border-radius:18px;
  padding:35px 20px;
  text-align:center;
  border:1px solid #e8e1ef;
}

.empty h2{
  margin-bottom:8px;
}

.empty p{
  color:#777;
  font-size:14px;
}

.refresh{
  margin-top:15px;
  border:0;
  background:#6d3df5;
  color:#fff;
  padding:11px 18px;
  border-radius:10px;
  font-weight:700;
  cursor:pointer;
}

@media(max-width:600px){

  .container{
    margin-top:18px;
  }

  .page-title h1{
    font-size:25px;
  }

  .post{
    border-radius:14px;
  }

  .actions{
    flex-wrap:wrap;
  }

}
</style>
</head>

<body>

<header class="header">

  <div class="header-inner">

    <a href="index.html" class="logo">
      Boostly
    </a>

    <a href="dashboard.html" class="back">
      ← Dashboard
    </a>

  </div>

</header>


<main class="container">

  <div class="page-title">

    <h1>🚀 Boost Feed</h1>

    <p>
      Discover the latest posts from Boostly businesses.
    </p>

  </div>


  <div id="status" class="status">
    Loading Boost Feed...
  </div>


  <div id="feed"></div>

</main>


<script>

const feed =
  document.getElementById("feed");

const statusBox =
  document.getElementById("status");


/* =====================================================
   ESCAPE HTML
===================================================== */

function escapeHtml(value){

  if(value === null || value === undefined){
    return "";
  }

  return String(value)
    .replace(/&/g,"&amp;")
    .replace(/</g,"&lt;")
    .replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;")
    .replace(/'/g,"&#039;");

}


/* =====================================================
   LOAD POSTS
===================================================== */

async function loadFeed(){

  try{

    statusBox.style.display =
      "block";

    statusBox.textContent =
      "Loading Boost Feed...";

    feed.innerHTML = "";


    const response =
      await fetch(
        "/api/boost-post?business_id=1",
        {
          cache:"no-store"
        }
      );


    const data =
      await response.json();


    if(!response.ok || data.success !== true){

      throw new Error(
        data.error ||
        "Could not load posts"
      );

    }


    const posts =
      data.posts || [];


    statusBox.style.display =
      "none";


    if(posts.length === 0){

      feed.innerHTML = `

        <div class="empty">

          <h2>No Boost Posts Yet</h2>

          <p>
            Publish your first Boost Post to see it here.
          </p>

          <button
            class="refresh"
            onclick="location.href='create-post.html'">

            Create Boost Post

          </button>

        </div>

      `;

      return;

    }


    posts.forEach(post => {

      feed.appendChild(
        createPostCard(post)
      );

    });


  }catch(error){

    console.error(error);

    statusBox.style.display =
      "block";

    statusBox.textContent =
      "Unable to load Boost Feed.";

  }

}


/* =====================================================
   CREATE POST CARD
===================================================== */

function createPostCard(post){

  const article =
    document.createElement("article");

  article.className =
    "post";


  const businessName =
    escapeHtml(
      post.business_name ||
      "Boostly Business"
    );


  const category =
    escapeHtml(
      post.category || ""
    );


  const city =
    escapeHtml(
      post.city || ""
    );


  const caption =
    escapeHtml(
      post.caption || ""
    );


  const hashtags =
    escapeHtml(
      post.hashtags || ""
    );


  const location =
    escapeHtml(
      post.location || ""
    );


  const initials =
    businessName
      .charAt(0)
      .toUpperCase();


  const postType =
    post.post_type === "reel"
      ? "🎬 Reel"
      : "📸 Post";


  let mediaHTML = "";


  if(post.media_type === "video"){

    mediaHTML = `

      <div class="media">

        <video
          controls
          playsinline
          preload="metadata"
          src="${escapeHtml(post.media_url)}">
        </video>

      </div>

    `;

  }else{

    mediaHTML = `

      <div class="media">

        <img
          src="${escapeHtml(post.media_url)}"
          alt="${businessName} Boost Post"
          loading="lazy">

      </div>

    `;

  }


  article.innerHTML = `

    <div class="post-header">

      <div class="business-avatar">
        ${initials}
      </div>

      <div class="business-info">

        <div class="business-name">
          ${businessName}
        </div>

        <div class="business-meta">
          ${category}
          ${city ? " • " + city : ""}
        </div>

      </div>

      <div class="post-type">
        ${postType}
      </div>

    </div>


    ${mediaHTML}


    <div class="post-content">

      <div class="actions">

        <button
          class="action-btn"
          type="button"
          onclick="alert('Like system next step mein connect hoga.')">

          ❤️ ${post.likes_count || 0}

        </button>


        <button
          class="action-btn"
          type="button"
          onclick="alert('Comment system next step mein connect hoga.')">

          💬 ${post.comments_count || 0}

        </button>


        <button
          class="action-btn"
          type="button"
          onclick="alert('Save system next step mein connect hoga.')">

          🔖 ${post.saves_count || 0}

        </button>


        <button
          class="action-btn"
          type="button"
          onclick="sharePost('${escapeHtml(post.media_url)}','${businessName}')">

          ↗ Share

        </button>

      </div>


      ${
        caption
        ? `<div class="caption">${caption}</div>`
        : ""
      }


      ${
        hashtags
        ? `<div class="hashtags">${hashtags}</div>`
        : ""
      }


      ${
        location
        ? `<div class="location">📍 ${location}</div>`
        : ""
      }


      <div class="stats">

        👁 ${post.views_count || 0} views
        •
        🔄 ${post.shares_count || 0} shares

      </div>

    </div>

  `;


  return article;

}


/* =====================================================
   SHARE
===================================================== */

async function sharePost(url,businessName){

  const shareData = {

    title:
      businessName + " | Boostly",

    text:
      "Check this Boostly business post",

    url:
      url

  };


  try{

    if(
      navigator.share
    ){

      await navigator.share(
        shareData
      );

    }else{

      await navigator.clipboard.writeText(
        url
      );

      alert(
        "Post link copied."
      );

    }

  }catch(error){

    console.log(error);

  }

}


/* =====================================================
   START
===================================================== */

loadFeed();

</script>

</body>
</html>
