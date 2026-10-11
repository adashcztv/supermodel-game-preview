# Super Model game preview

Deployment wrapper for a separately hosted, playable visual novel preview on OVH. This is a review build, with final creative and physical-device acceptance still pending.

The runtime-v7 release contains the compiled public game files. Its ZIP SHA-256 is 53ed3ad3d23c2d5fdd7fcf02b9515b53a185bb7c9f80f92daca1393b660519c5. The Docker build verifies that digest before unpacking; working files, voice profiles and audition material are excluded.

NGINX listens on port 8080. Coolify provides HTTPS. No application backend, database, analytics or credentials are required. Player saves remain in the browser on this origin; the in-game export/import controls can move saves when the game is integrated into the main website.
