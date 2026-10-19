/**
 * Entry point for the packaged single-file binary (Node SEA).
 *
 * Import order here is load-bearing: the generated assets module must
 * evaluate first so `YTRIUM_WEB_PACKED`, `NODE_ENV` and the embedded frontend
 * are in place before `server/src/index` runs `config.ts` and `createApp`.
 */
import '../build/clientAssets.generated';
import '../server/src/index';
