# Apify base image with Node.js 20 (no browser needed — this Actor uses the
# official Socrata JSON API only, never browser automation).
FROM apify/actor-node:20

# Install production dependencies first (better layer caching).
COPY package.json ./
RUN npm --quiet set progress=false \
 && npm install --omit=dev --no-optional \
 && echo "Installed NPM packages:" \
 && (npm list --omit=dev --all || true) \
 && echo "Node.js version:" \
 && node --version

# Copy the rest of the source.
COPY . ./

# Run the Actor.
CMD ["node", "src/main.js"]
