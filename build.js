// build.js

// 1. Load the .env file and set the environment variables
require("dotenv").config();

// 2. Import the electron-builder library
const builder = require("electron-builder");

// 3. Run the build process
builder
  .build({
    config: {
      // You can pass configuration here, but for now it will use the "build" section from package.json
    },
  })
  .then(() => {
    console.log("Build complete!");
  })
  .catch((err) => {
    console.error("Build failed:", err);
  });
