// build.js

// 1. Load the .env file
require("dotenv").config();

// 2. Import electron-builder
const builder = require("electron-builder");
const Platform = builder.Platform;

console.log("Starting build process...");

// 3. Run the build process with explicit configuration
builder
  .build({
    targets: Platform.WINDOWS.createTarget(), // Explicitly build for Windows
    config: {
      // All configuration is now read from package.json,
      // but you could override it here if needed.
    },
    // This is the most important flag, tells builder to publish
    // after a successful build.
    publish: "always",
  })
  .then((result) => {
    // The result array contains the paths to the built files
    console.log("Build complete!");
    console.log("Built files:", result);
  })
  .catch((err) => {
    console.error("Build failed:", err);
  });
