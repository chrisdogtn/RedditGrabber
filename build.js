// build.js

// 1. Load the .env file and set the environment variables
require("dotenv").config();

// 2. Import the electron-builder library
const builder = require("electron-builder");

console.log("Starting build and publish process...");

// 3. Run the build process
builder
  .build({
    // This tells the builder to publish after a successful build.
    // It will look for the GH_TOKEN in the environment variables we just loaded.
    publish: "always",
    config: {
      // All other configuration is read from package.json
    },
  })
  .then((result) => {
    console.log("Build complete!");
    console.log("Built files:", result);
  })
  .catch((err) => {
    console.error("Build failed:", err);
  });
