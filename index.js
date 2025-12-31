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

// Helper function to check if URL is a valid video
async function isValidVideo(url, acceptedFormats = null) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    
    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow'
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      return false;
    }
    
    const contentType = response.headers.get('content-type') || '';
    
    // If specific formats requested, check against them
    if (acceptedFormats && acceptedFormats.length > 0) {
      return acceptedFormats.some(format => {
        const formatLower = format.toLowerCase();
        return contentType.toLowerCase().includes(formatLower) || 
               url.toLowerCase().includes(`.${formatLower}`);
      });
    }
    
    // Otherwise check for common video types
    const isVideo = contentType.startsWith('video/') ||
                    /\.(mp4|mkv|avi|mov|wmv|flv|webm|m3u8|ts)$/i.test(url);
    
    return isVideo;
  } catch (error) {
    // Timeout or network error
    return false;
  }
}

// Helper function to find first valid video stream
async function findValidVideoStream(streams, acceptedFormats = null) {
  for (const stream of streams) {
    if (!stream.url) continue;
    
    const isValid = await isValidVideo(stream.url, acceptedFormats);
    if (isValid) {
      return stream;
    }
  }
  return null;
}
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
    const { format } = request.query;
    
    // Validate IMDb ID format
    if (!imdb.match(/^tt\d+$/)) {
      return reply.code(400).send({
        error: 'Invalid IMDb ID format. Must be in format: ttXXXXXXX'
      });
    }

    // Parse accepted formats from query param
    const acceptedFormats = format ? format.split(',').map(f => f.trim()) : null;

    const streamUrl = `${ADDON_BASE_URL}/stream/movie/${imdb}.json`;
    const data = await fetchStremioStreams(streamUrl);

    if (!data.streams || data.streams.length === 0) {
      return reply.code(404).send({
        error: 'No streams found for this movie'
      });
    }

    // Find first valid video stream
    const validStream = await findValidVideoStream(data.streams, acceptedFormats);
    
    if (!validStream) {
      return reply.code(404).send({
        error: 'No valid video streams found',
        message: acceptedFormats 
          ? `No streams matching formats: ${acceptedFormats.join(', ')}`
          : 'No accessible video streams found'
      });
    }

    // Redirect to the valid stream URL
    return reply.redirect(validStream.url);

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

    // Parse accepted formats from query param
    const acceptedFormats = format ? format.split(',').map(f => f.trim()) : null;

    const streamUrl = `${ADDON_BASE_URL}/stream/series/${imdb}:${season}:${episode}.json`;
    const data = await fetchStremioStreams(streamUrl);

    if (!data.streams || data.streams.length === 0) {
      return reply.code(404).send({
        error: 'No streams found for this episode'
      });
    }

    // Find first valid video stream
    const validStream = await findValidVideoStream(data.streams, acceptedFormats);
    
    if (!validStream) {
      return reply.code(404).send({
        error: 'No valid video streams found',
        message: acceptedFormats 
          ? `No streams matching formats: ${acceptedFormats.join(', ')}`
          : 'No accessible video streams found'
      });
    }

    // Redirect to the valid stream URL
    return reply.redirect(validStream.url);

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
    name: 'Stremio First Stream URL API',
    version: '3.0.0',
    description: 'Get the first stream URL from Stremio addon',
    configured: !!ADDON_BASE_URL,
    endpoints: {
      movie: {
        method: 'GET',
        path: '/movie/{imdb}',
        example: '/movie/tt32063098',
        queryParams: {
          format: 'Optional: Comma-separated video formats (e.g., ?format=mkv,mp4)'
        },
        returns: 'Redirects to the first valid stream URL'
      },
      tv: {
        method: 'GET',
        path: '/tv/{imdb}/{season}/{episode}',
        example: '/tv/tt32063098/1/1?format=mkv',
        queryParams: {
          format: 'Optional: Comma-separated video formats (e.g., ?format=mkv,mp4)'
        },
        returns: 'Redirects to the first valid stream URL'
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