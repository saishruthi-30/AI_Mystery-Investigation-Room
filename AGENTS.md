# Project implementation notes

- Treat `spec.md` as the product source of truth.
- Keep Gemini calls and solution evaluation on the server.
- Do not serialize the `solution` field in pre-accusation API responses.
- Validate all user and generated data at the server boundary.
- Keep optional visual providers optional and label reconstructions accurately.
- Keep the client and API in their existing folders and retain the MERN/Gemini stack.
