/**
 * Node.js example for rust-fetch
 * Demonstrates using rust-fetch in a Node.js environment
 * 
 * To run: node examples/node-example.js
 */

// In Node.js, you might need to polyfill fetch or use dynamic imports
// This example assumes ESM modules are enabled in your Node.js project

import { readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Import rust-fetch - adjust the path based on your setup
import init, { WasmClient, fetch_json } from '../wasm-module/pkg/rust_fetch.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function initializeWasm() {
    // In Node.js, you need to manually load the WASM file
    const wasmPath = join(__dirname, '..', 'wasm-module', 'pkg', 'rust_fetch_bg.wasm');
    const wasmBuffer = await readFile(wasmPath);
    
    // Initialize with the WASM buffer
    await init(wasmBuffer);
}

async function main() {
    console.log('🚀 rust-fetch Node.js example\n');
    
    // Initialize WASM
    await initializeWasm();
    
    // Example 1: Fetching package info from npm registry
    console.log('1. Fetching package info from npm registry...');
    try {
        const packageInfo = await fetch_json('https://registry.npmjs.org/rust-fetch/latest');
        console.log('Package name:', packageInfo.name);
        console.log('Version:', packageInfo.version);
        console.log('Description:', packageInfo.description);
    } catch (error) {
        console.error('Error fetching package info:', error);
    }
    
    console.log('\n---\n');
    
    // Example 2: Using WasmClient for API interactions
    console.log('2. Interacting with REST API...');
    const client = new WasmClient();
    
    // Fetch user data
    try {
        const users = await client.get('https://jsonplaceholder.typicode.com/users');
        console.log(`Fetched ${users.body.length} users`);
        console.log('First user:', users.body[0].name);
    } catch (error) {
        console.error('Error fetching users:', error);
    }
    
    console.log('\n---\n');
    
    // Example 3: Simulating a backend service interaction
    console.log('3. Backend service example...');
    
    // Create a new resource
    try {
        const newTodo = {
            title: 'Process data with rust-fetch',
            completed: false,
            userId: 1
        };
        
        const response = await client.post_json('https://jsonplaceholder.typicode.com/todos', newTodo);
        console.log('Created todo with ID:', response.body.id);
        
        // Verify creation by fetching it back
        const verifyResponse = await client.get(`https://jsonplaceholder.typicode.com/todos/${response.body.id}`);
        console.log('Verified todo:', verifyResponse.body);
    } catch (error) {
        console.error('Error in backend service interaction:', error);
    }
    
    console.log('\n---\n');
    
    // Example 4: Batch operations
    console.log('4. Batch operations example...');
    try {
        const userIds = [1, 2, 3, 4, 5];
        
        console.log('Fetching multiple users in parallel...');
        const userPromises = userIds.map(id => 
            client.get(`https://jsonplaceholder.typicode.com/users/${id}`)
        );
        
        const users = await Promise.all(userPromises);
        
        users.forEach(userResponse => {
            const user = userResponse.body;
            console.log(`- ${user.name} (${user.email})`);
        });
    } catch (error) {
        console.error('Error in batch operations:', error);
    }
    
    console.log('\n---\n');
    
    // Example 5: Error handling in production scenarios
    console.log('5. Production error handling...');
    
    async function fetchWithRetry(url, maxRetries = 3) {
        for (let i = 0; i < maxRetries; i++) {
            try {
                const response = await client.get(url);
                return response;
            } catch (error) {
                console.log(`Attempt ${i + 1} failed:`, error.message);
                
                if (i === maxRetries - 1) {
                    throw error;
                }
                
                // Wait before retrying (exponential backoff)
                await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
            }
        }
    }
    
    try {
        // This will fail and demonstrate retry logic
        await fetchWithRetry('https://httpbin.org/status/500');
    } catch (error) {
        console.log('Final error after retries:', error.kind, '-', error.message);
    }
    
    console.log('\n✅ Node.js example completed!');
}

// Run the example
main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
