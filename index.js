import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';

const fastify = Fastify({ logger: true });

// Enable CORS
await fastify.register(cors, {
  origin: '*'
});

// Global addon base URL
let ADDON_BASE_URL = null;
let ADDON_MANIFEST = null;

// Helper function to extract base URL from manifest URL
function getBaseUrlFromManifest(manifestUrl) {
  try {
    // Remove trailing slash if present
    manifestUrl = manifestUrl.trim().replace(/\/$/, '');
    
    // Remove /manifest.json from the end
    if (manifestUrl.endsWith('/manifest.json')) {
      return manifestUrl.replace(/\/manifest\.json$/, '');
    }
    
    throw new Error('Invalid manifest URL. Must end with /manifest.json');
  } catch (error) {
    throw new Error(`Invalid manifest URL format: ${error.message}`);
  }
}

// Helper function to fetch and validate manifest
async function initializeAddon(manifestUrl) {
  try {
    console.log(`Fetching manifest from: ${manifestUrl}`);
    const response = await fetch(manifestUrl);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch manifest: ${response.statusText}`);
    }
    
    const manifest = await response.json();
    const baseUrl = getBaseUrlFromManifest(manifestUrl);
    
    ADDON_BASE_URL = baseUrl;
    ADDON_MANIFEST = manifest;
    
    console.log(`✅ Addon configured successfully!`);
    console.log(`   Name: ${manifest.name || 'Unknown'}`);
    console.log(`   Base URL: ${baseUrl}`);
    console.log(`   Version: ${manifest.version || 'Unknown'}`);
    
    return { baseUrl, manifest };
  } catch (error) {
    console.error(`❌ Error initializing addon: ${error.message}`);
    throw error;
  }
}

// Helper function to fetch Stremio addon streams
async function fetchStremioStreams(streamUrl) {
  try {
    const response = await fetch(streamUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch streams: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    throw new Error(`Error fetching Stremio addon: ${error.message}`);
  }
}

// Helper function to generate HTML video player
function generateVideoPlayerHTML(streamUrl, title = 'Video Player') {
  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <meta charset="UTF-8">
  <title>${title}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      background: #000;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    #video-container {
      width: 100vw;
      height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #000;
    }
    video {
      width: 100%;
      height: 100%;
      object-fit: contain;
      background: #000;
    }
    #loading {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      color: white;
      font-size: 18px;
      text-align: center;
    }
    .spinner {
      border: 4px solid rgba(255, 255, 255, 0.3);
      border-top: 4px solid white;
      border-radius: 50%;
      width: 40px;
      height: 40px;
      animation: spin 1s linear infinite;
      margin: 0 auto 15px;
    }
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
    #error {
      display: none;
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      color: #ff4444;
      font-size: 16px;
      text-align: center;
      padding: 20px;
      max-width: 80%;
    }
  </style>
</head>
<body>
  <div id="video-container">
    <div id="loading">
      <div class="spinner"></div>
      <div>Loading video...</div>
    </div>
    <div id="error">
      <div style="font-size: 48px; margin-bottom: 10px;">⚠️</div>
      <div id="error-message">Failed to load video</div>
    </div>
    <video id="video" 
           controls 
           autoplay 
           playsinline 
           preload="auto"
           controlsList="nodownload">
      <source src="${streamUrl}" type="video/mp4">
      <source src="${streamUrl}" type="video/webm">
      <source src="${streamUrl}" type="application/x-mpegURL">
      Your browser does not support the video tag.
    </video>
  </div>

  <script>
    const video = document.getElementById('video');
    const loading = document.getElementById('loading');
    const error = document.getElementById('error');
    const errorMessage = document.getElementById('error-message');

    // Hide loading when video can play
    video.addEventListener('loadeddata', () => {
      loading.style.display = 'none';
    });

    video.addEventListener('canplay', () => {
      loading.style.display = 'none';
    });

    // Show error if video fails to load
    video.addEventListener('error', (e) => {
      loading.style.display = 'none';
      error.style.display = 'block';
      
      const errorCode = video.error ? video.error.code : 'unknown';
      const errorText = video.error ? video.error.message : 'Unknown error';
      
      errorMessage.innerHTML = \`Failed to load video<br><small style="font-size: 12px; opacity: 0.7;">Error: \${errorText}</small>\`;
    });

    // Prevent context menu on long press
    video.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      return false;
    });
  </script>
</body>
</html>`;
}

// Helper function to convert streams to M3U8 format
function streamsToM3U8(streams, title = 'Playlist') {
  let m3u8Content = '#EXTM3U\n';
  m3u8Content += '#EXT-X-VERSION:3\n\n';

  if (!streams || streams.length === 0) {
    return m3u8Content;
  }

  streams.forEach((stream, index) => {
    // Extract quality info from title or name
    const streamTitle = stream.title || stream.name || `Stream ${index + 1}`;
    const streamName = stream.name || 'Unknown Source';
    
    // Parse quality and size from title
    const qualityMatch = streamTitle.match(/(\d+p)/);
    const sizeMatch = streamTitle.match(/([\d.]+GB)/);
    const quality = qualityMatch ? qualityMatch[1] : 'Unknown';
    const size = sizeMatch ? sizeMatch[1] : '';
    
    // Determine bandwidth based on quality (rough estimates)
    let bandwidth = 5000000; // default 5Mbps
    if (quality.includes('2160p') || quality.includes('4K')) {
      bandwidth = 20000000; // 20Mbps for 4K
    } else if (quality.includes('1080p')) {
      bandwidth = 8000000; // 8Mbps for 1080p
    } else if (quality.includes('720p')) {
      bandwidth = 5000000; // 5Mbps for 720p
    } else if (quality.includes('480p')) {
      bandwidth = 2500000; // 2.5Mbps for 480p
    }

    // Add stream info
    const displayName = `${streamName} - ${quality}${size ? ' - ' + size : ''}`;
    
    m3u8Content += `#EXTINF:-1 tvg-name="${displayName}" group-title="${streamName}",${displayName}\n`;
    m3u8Content += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidth}\n`;
    m3u8Content += `${stream.url}\n\n`;
  });

  return m3u8Content;
}

// Middleware to check if addon is configured
fastify.addHook('preHandler', async (request, reply) => {
  const skipRoutes = ['/', '/health', '/info'];
  
  if (!skipRoutes.includes(request.url) && !ADDON_BASE_URL) {
    reply.code(503).send({
      error: 'Addon not configured',
      message: 'Please set MANIFEST_URL environment variable',
      example: 'MANIFEST_URL=https://nuviostreams.hayd.uk/manifest.json'
    });
  }
});

// Movie endpoint
fastify.get('/movie/:imdb', async (request, reply) => {
  try {
    const { imdb } = request.params;
    const { format } = request.query;
    
    // Validate IMDb ID format
    if (!imdb.match(/^tt\d+$/)) {
      return reply.code(400).send({
        error: 'Invalid IMDb ID format. Must be in format: ttXXXXXXX'
      });
    }

    const streamUrl = `${ADDON_BASE_URL}/stream/movie/${imdb}.json`;
    const data = await fetchStremioStreams(streamUrl);

    if (!data.streams || data.streams.length === 0) {
      return reply.code(404).send({
        error: 'No streams found for this movie'
      });
    }

    // Check if format is m3u8 (return playlist)
    if (format === 'm3u8') {
      const m3u8Content = streamsToM3U8(data.streams, `Movie ${imdb}`);
      return reply
        .header('Content-Type', 'application/vnd.apple.mpegurl')
        .header('Content-Disposition', `attachment; filename="${imdb}.m3u8"`)
        .send(m3u8Content);
    }

    // Default: Return HTML video player with first stream
    const firstStream = data.streams[0];
    const html = generateVideoPlayerHTML(firstStream.url, `Movie ${imdb}`);
    
    return reply
      .header('Content-Type', 'text/html')
      .send(html);

  } catch (error) {
    fastify.log.error(error);
    reply.code(500).send({
      error: 'Failed to fetch movie streams',
      message: error.message
    });
  }
});

// TV Show endpoint
fastify.get('/tv/:imdb/:season/:episode', async (request, reply) => {
  try {
    const { imdb, season, episode } = request.params;
    const { format } = request.query;
    
    // Validate IMDb ID format
    if (!imdb.match(/^tt\d+$/)) {
      return reply.code(400).send({
        error: 'Invalid IMDb ID format. Must be in format: ttXXXXXXX'
      });
    }

    // Validate season and episode are numbers
    if (isNaN(season) || isNaN(episode)) {
      return reply.code(400).send({
        error: 'Season and episode must be valid numbers'
      });
    }

    const streamUrl = `${ADDON_BASE_URL}/stream/series/${imdb}:${season}:${episode}.json`;
    const data = await fetchStremioStreams(streamUrl);

    if (!data.streams || data.streams.length === 0) {
      return reply.code(404).send({
        error: 'No streams found for this episode'
      });
    }

    // Check if format is m3u8 (return playlist)
    if (format === 'm3u8') {
      const m3u8Content = streamsToM3U8(
        data.streams, 
        `TV Show ${imdb} S${season}E${episode}`
      );
      return reply
        .header('Content-Type', 'application/vnd.apple.mpegurl')
        .header('Content-Disposition', `attachment; filename="${imdb}_S${season}E${episode}.m3u8"`)
        .send(m3u8Content);
    }

    // Default: Return HTML video player with first stream
    const firstStream = data.streams[0];
    const html = generateVideoPlayerHTML(
      firstStream.url, 
      `TV Show ${imdb} S${season}E${episode}`
    );
    
    return reply
      .header('Content-Type', 'text/html')
      .send(html);

  } catch (error) {
    fastify.log.error(error);
    reply.code(500).send({
      error: 'Failed to fetch TV show streams',
      message: error.message
    });
  }
});

// Info endpoint - shows current configuration
fastify.get('/info', async (request, reply) => {
  return {
    configured: !!ADDON_BASE_URL,
    addon: ADDON_MANIFEST ? {
      name: ADDON_MANIFEST.name || 'Unknown',
      version: ADDON_MANIFEST.version || 'Unknown',
      description: ADDON_MANIFEST.description || 'No description',
      baseUrl: ADDON_BASE_URL
    } : null,
    environment: {
      manifestUrl: process.env.MANIFEST_URL || 'Not set'
    }
  };
});

// Health check endpoint
fastify.get('/health', async (request, reply) => {
  return { 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    addonConfigured: !!ADDON_BASE_URL
  };
});

// Root endpoint with API documentation
fastify.get('/', async (request, reply) => {
  return {
    name: 'Stremio to M3U8 API',
    version: '3.0.0',
    description: 'Convert Stremio addon streams to M3U8 playlists',
    configured: !!ADDON_BASE_URL,
    endpoints: {
      movie: {
        method: 'GET',
        path: '/movie/{imdb}',
        example: '/movie/tt32063098',
        queryParams: {
          format: 'Optional: "m3u8" for playlist file (default: HTML video player)'
        },
        returns: 'HTML video player page (or M3U8 with ?format=m3u8)'
      },
      tv: {
        method: 'GET',
        path: '/tv/{imdb}/{season}/{episode}',
        example: '/tv/tt32063098/1/1',
        queryParams: {
          format: 'Optional: "m3u8" for playlist file (default: HTML video player)'
        },
        returns: 'HTML video player page (or M3U8 with ?format=m3u8)'
      },
      info: {
        method: 'GET',
        path: '/info',
        description: 'Get current addon configuration'
      },
      health: {
        method: 'GET',
        path: '/health',
        description: 'Health check endpoint'
      }
    },
    setup: {
      required: 'Set MANIFEST_URL environment variable',
      examples: [
        'MANIFEST_URL=https://nuviostreams.hayd.uk/manifest.json',
        'MANIFEST_URL=https://nuviostreams.hayd.uk/token123/manifest.json',
        'MANIFEST_URL=https://nuviostreams.hayd.uk/path/to/manifest.json'
      ]
    }
  };
});

// Start server
const start = async () => {
  try {
    // Initialize addon from environment variable
    const manifestUrl = process.env.MANIFEST_URL;
    
    if (manifestUrl) {
      try {
        await initializeAddon(manifestUrl);
      } catch (error) {
        console.error('⚠️  Warning: Failed to initialize addon on startup');
        console.error('   You can still start the server, but endpoints will return 503');
      }
    } else {
      console.warn('⚠️  Warning: MANIFEST_URL environment variable not set');
      console.warn('   Server will start but endpoints will return 503 until configured');
    }
    
    const port = process.env.PORT || 3000;
    const host = process.env.HOST || '0.0.0.0';
    
    await fastify.listen({ port, host });
    console.log(`\n🚀 Server listening on ${host}:${port}`);
    console.log(`📡 API Documentation: http://${host}:${port}/`);
    console.log(`ℹ️  Configuration Info: http://${host}:${port}/info\n`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();