// Photo studio: cuts the item out of its background with Cloudflare Images (BiRefNet), returns a transparent PNG.
// The phone then places it on a clean backdrop, so the look can change without another round trip.
import {HttpError, readBody} from './security.js';
import {imageFromDataUrl, aiAllowance} from './llm.js';

export async function studioRoute(request, env, user) {
  if (request.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
  if (!user) throw new HttpError(401, 'Sign in first.');
  if (!env.IMAGES) throw new HttpError(503, 'Photo studio isn’t switched on yet.');
  const {image} = await readBody(request, 6_000_000) || {};
  const bytes = imageFromDataUrl(image, 5_600_000);
  if (!bytes) throw new HttpError(400, 'Send one photo.');
  await aiAllowance(env, user);
  let png;
  try {
    const stream = new Response(bytes).body;
    const result = await env.IMAGES.input(stream).transform({segment: 'foreground'}).output({format: 'image/png'});
    png = new Uint8Array(await result.response().arrayBuffer());
  } catch (error) {
    console.log(JSON.stringify({studio: 'error', message: String(error?.message || error).slice(0, 300)}));
    throw new HttpError(502, 'Couldn’t clean up that photo. Try another one.');
  }
  let binary = '';
  for (let i = 0; i < png.length; i += 0x8000) binary += String.fromCharCode(...png.subarray(i, i + 0x8000));
  return {cutout: 'data:image/png;base64,' + btoa(binary)};
}
