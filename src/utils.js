const https = require('https');
const fs = require('fs');
const path = require('path');

function downloadFile(url, dest) {
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);

        const request = https.get(url, (response) => {
            // Check if response is successful (status code 200-299)
            if (response.statusCode < 200 || response.statusCode >= 300) {
                file.close(() => {
                    fs.unlink(dest, () => {}); // Delete the empty file
                });
                reject(new Error(`Failed to download file. Status Code: ${response.statusCode}`));
                return;
            }

            response.pipe(file);

            file.on('finish', () => {
                file.close(err => {
                    if (err) {
                        fs.unlink(dest, () => {}); // Clean up on close error
                        reject(err);
                    } else {
                        resolve();
                    }
                });
            });
        });

        request.on('error', (err) => {
            // Handle request errors (e.g., DNS issues, network errors)
            file.close(() => {
                fs.unlink(dest, () => {}); // Delete the empty file
            });
            reject(err);
        });
    });
}

module.exports = { downloadFile };
