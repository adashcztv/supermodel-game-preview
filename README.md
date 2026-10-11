# Super Model game preview

Deployment wrapper for a separately hosted, playable visual novel preview on OVH. This is a review build, with final creative and physical-device acceptance still pending.

The runtime-v8 release contains the compiled public game files. Its ZIP SHA-256 is 4163b3ef0bdd39262b4358e8e91683e2be066fa55b8943d4d562a82636a10978. The Docker build verifies that digest before unpacking; working files, voice profiles and audition material are excluded.

NGINX listens on port 8080. Coolify provides HTTPS. No application backend, database, analytics or credentials are required. Player saves remain in the browser on this origin; the in-game export/import controls can move saves when the game is integrated into the main website.

This version adds short sentence-paged original voices, an authored opening over the approved room, soundtrack/SFX/ambience, consistent action frames and the existing native Unity arena. It does not implement the future rigged 3D heroine combat pilot. The locally generated LTX candidate changed the room and is excluded.
