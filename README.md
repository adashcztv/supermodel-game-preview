# Super Model delivery v20 / native v38

Clears inactive legacy texture slots, preserving model/animation/bitmap sources.
Existing frontend,gameplay and UI bytes retained. Lossless Brotli for the current
four native files; gzip/identity and all prior client paths remain available.
Parent image ID and layers are frozen in parent-image.json. Layered source/build
is not release acceptance; use the existing serialized native builder and safe
native rolling adapter. GitHub Actions and implicit auto-deploy stay disabled.

Game source: 2c0db6bc60e36409b2bdbe21d87086e22215d1ab.
Archive SHA-256: 2c0e411cf73a799b4c67ea9ccc4d54e17ef2b0028128a6aa12ecedc18f05299a.
