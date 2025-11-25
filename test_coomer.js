const axios = require('axios');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function testApi() {
    const url = 'https://coomer.st/api/v1/onlyfans/user/queeniesteph';
    console.log(`Testing API: ${url}`);
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'application/json'
            }
        });
        console.log('API Success!');
        console.log('Data length:', response.data.length);
        console.log('First item:', JSON.stringify(response.data[0], null, 2));
    } catch (error) {
        console.error('API Failed:', error.message);
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', error.response.data);
        }
    }
}

async function testHtml() {
    const url = 'https://coomer.st/onlyfans/user/queeniesteph';
    console.log(`Testing HTML: ${url}`);
    try {
        const response = await axios.get(url, {
            headers: {
                'User-Agent': USER_AGENT
            }
        });
        console.log('HTML Success!');
        console.log('Content preview:', response.data.substring(0, 200));
    } catch (error) {
        console.error('HTML Failed:', error.message);
    }
}

(async () => {
    await testApi();
    await testHtml();
})();
