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

// MIME type mappings
const MIME_TYPE_MAP = {
  'mp4': 'video/mp4',
  'webm': 'video/webm',
  'mkv': 'video/x-matroska',
  'avi': 'video/x-msvideo',
  'mov': 'video/quicktime',
  'flv': 'video/x-flv',
  'wmv': 'video/x-ms-wmv',
  'mpeg': 'video/mpeg',
  'mpg': 'video/mpeg',
  '3gp': 'video/3gpp',
  'ogv': 'video/ogg',
  'ts': 'video/mp2t',
  'm3u8': 'application/x-mpegURL',
  'hls': 'application/x-mpegURL'
};

// Helper function to get MIME type from format
function getMimeType(format) {
  return MIME_TYPE_MAP[format.toLowerCase()] || null;
}

// Helper function to detect MIME type using HEAD request
async function detectStreamMimeType(stream) {
  // Check if stream has explicit MIME type
  if (stream.mimeType) {
    return stream.mimeType.toLowerCase();
  }

  const url = stream.url || '';
  
  try {
    // Make HEAD request to get Content-Type
    const response = await fetch(url, { 
      method: 'HEAD',
      signal: AbortSignal.timeout(5000) // 5 second timeout
    });
    
    const contentType = response.headers.get('content-type');
    
    if (contentType) {
      // Extract MIME type (remove parameters like charset)
      const mimeType = contentType.split(';')[0].trim().toLowerCase();
      return mimeType;
    }
  } catch (error) {
    // If HEAD request fails, fall back to URL analysis
    fastify.log.warn(`HEAD request failed for ${url}: ${error.message}`);
  }

  // Fallback: Try to detect from URL extension
  const extensionMatch = url.match(/\.([a-z0-9]+)(?:\?|$)/i);
  
  if (extensionMatch) {
    const extension = extensionMatch[1].toLowerCase();
    const mimeType = getMimeType(extension);
    if (mimeType) return mimeType;
  }

  // Check for HLS/M3U8 indicators
  if (url.includes('.m3u8') || url.includes('m3u8')) {
    return 'application/x-mpegurl';
  }

  // Default to mp4
  return 'video/mp4';
}

// Helper function to filter streams by format
async function filterStreamsByFormat(streams, format = 'mp4') {
  const targetMimeType = getMimeType(format);
  
  if (!targetMimeType) {
    throw new Error(`Unsupported format: ${format}. Supported formats: ${Object.keys(MIME_TYPE_MAP).join(', ')}`);
  }

  // Check each stream's MIME type via HEAD request
  const streamChecks = await Promise.allSettled(
    streams.map(async (stream) => {
      const streamMimeType = await detectStreamMimeType(stream);
      return {
        stream,
        mimeType: streamMimeType,
        matches: streamMimeType === targetMimeType
      };
    })
  );

  // Filter successful checks that match the target MIME type
  const filtered = streamChecks
    .filter(result => result.status === 'fulfilled' && result.value.matches)
    .map(result => result.value.stream);

  return filtered;
}

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
    const { format = 'mp4' } = request.query;
    
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

    // Filter streams by format
    let filteredStreams;
    try {
      filteredStreams = await filterStreamsByFormat(data.streams, format);
    } catch (error) {
      return reply.code(400).send({
        error: error.message,
        availableFormats: Object.keys(MIME_TYPE_MAP)
      });
    }

    if (filteredStreams.length === 0) {
      return reply.code(404).send({
        error: `No streams found with format: ${format}`,
        hint: 'Try a different format',
        availableFormats: Object.keys(MIME_TYPE_MAP),
        totalStreamsFound: data.streams.length
      });
    }

    // Redirect to the first filtered stream URL
    const firstStream = filteredStreams[0];
    return reply.redirect(firstStream.url);

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
    const { format = 'mp4' } = request.query;
    
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

    // Filter streams by format
    let filteredStreams;
    try {
      filteredStreams = await filterStreamsByFormat(data.streams, format);
    } catch (error) {
      return reply.code(400).send({
        error: error.message,
        availableFormats: Object.keys(MIME_TYPE_MAP)
      });
    }

    if (filteredStreams.length === 0) {
      return reply.code(404).send({
        error: `No streams found with format: ${format}`,
        hint: 'Try a different format',
        availableFormats: Object.keys(MIME_TYPE_MAP),
        totalStreamsFound: data.streams.length
      });
    }

    // Redirect to the first filtered stream URL
    const firstStream = filteredStreams[0];
    return reply.redirect(firstStream.url);

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
    supportedFormats: Object.keys(MIME_TYPE_MAP),
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
    name: 'Stremio Stream Redirect API',
    version: '3.1.0',
    description: 'Get and filter stream URLs from Stremio addon by format',
    configured: !!ADDON_BASE_URL,
    endpoints: {
      movie: {
        method: 'GET',
        path: '/movie/{imdb}',
        example: '/movie/tt32063098?format=mp4',
        queryParams: {
          format: 'Optional: Video format (default: mp4). Example: mp4, webm, mkv, m3u8'
        },
        returns: 'Redirects to the first stream URL matching the format'
      },
      tv: {
        method: 'GET',
        path: '/tv/{imdb}/{season}/{episode}',
        example: '/tv/tt32063098/1/1?format=mp4',
        queryParams: {
          format: 'Optional: Video format (default: mp4). Example: mp4, webm, mkv, m3u8'
        },
        returns: 'Redirects to the first stream URL matching the format'
      },
      info: {
        method: 'GET',
        path: '/info',
        description: 'Get current addon configuration and supported formats'
      },
      health: {
        method: 'GET',
        path: '/health',
        description: 'Health check endpoint'
      }
    },
    supportedFormats: Object.keys(MIME_TYPE_MAP),
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