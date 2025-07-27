// @ts-check
/**
 * Basic example demonstrating simple HTTP requests with rust-fetch
 */

import init, { WasmClient, fetch_json, fetch_text } from 'rust-fetch';

async function main() {
    // Initialize the WASM module
    await init();
    
    console.log('🚀 rust-fetch basic example\n');
    
    // Example 1: Simple JSON fetch
    console.log('1. Fetching JSON data...');
    try {
        const todoData = await fetch_json('https://jsonplaceholder.typicode.com/todos/1');
        console.log('Todo:', todoData);
    } catch (error) {
        console.error('Error fetching JSON:', error);
    }
    
    console.log('\n---\n');
    
    // Example 2: Using WasmClient for multiple requests
    console.log('2. Using WasmClient for multiple operations...');
    const client = new WasmClient();
    
    // GET request
    try {
        const post = await client.get('https://jsonplaceholder.typicode.com/posts/1');
        console.log('GET - Post data:', post.body);
    } catch (error) {
        console.error('GET error:', error);
    }
    
    // POST request
    try {
        const newPost = {
            title: 'Hello from rust-fetch!',
            body: 'This is a test post created with rust-fetch',
            userId: 1
        };
        
        const response = await client.post_json('https://jsonplaceholder.typicode.com/posts', newPost);
        console.log('POST - Created post:', response.body);
        console.log('Status:', response.status);
    } catch (error) {
        console.error('POST error:', error);
    }
    
    console.log('\n---\n');
    
    // Example 3: Error handling
    console.log('3. Error handling example...');
    try {
        await fetch_json('https://invalid-domain-that-does-not-exist.com/api/data');
    } catch (error) {
        console.log('Caught expected error:');
        console.log('  Error kind:', error.kind);
        console.log('  Error message:', error.message);
    }
}

// Run the example
main().catch(console.error);
