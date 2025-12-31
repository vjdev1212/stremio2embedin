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

    // Return the first stream URL
    const firstStream = data.streams[0];
    return reply.send({
      url: firstStream.url,
      title: firstStream.title || firstStream.name || 'Stream',
      name: firstStream.name || 'Unknown Source'
    });

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

    // Return the first stream URL
    const firstStream = data.streams[0];
    return reply.send({
      url: firstStream.url,
      title: firstStream.title || firstStream.name || 'Stream',
      name: firstStream.name || 'Unknown Source'
    });

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
    name: 'Stremio to EmbedIn API',
    version: '3.0.0',
    description: 'Convert Stremio addon to EmbedIn',
    configured: !!ADDON_BASE_URL,
    endpoints: {
      movie: {
        method: 'GET',
        path: '/movie/{imdb}',
        example: '/movie/tt32063098',
        returns: 'First stream URL with metadata'
      },
      tv: {
        method: 'GET',
        path: '/tv/{imdb}/{season}/{episode}',
        example: '/tv/tt32063098/1/1',
        returns: 'First stream URL with metadata'
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