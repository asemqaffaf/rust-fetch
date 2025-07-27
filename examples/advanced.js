// @ts-check
/**
 * Advanced example demonstrating complex HTTP requests with rust-fetch
 * Shows: custom headers, authentication, all HTTP methods, and error handling
 */

import init, { WasmClient } from 'rust-fetch';

async function main() {
    // Initialize the WASM module
    await init();
    
    console.log('🚀 rust-fetch advanced example\n');
    
    const client = new WasmClient();
    
    // Example 1: Custom headers with authentication
    console.log('1. Custom request with authentication headers...');
    try {
        const headers = {
            'Authorization': 'Bearer your-api-token-here',
            'X-API-Version': '2.0',
            'Accept': 'application/json',
            'User-Agent': 'rust-fetch-example/1.0'
        };
        
        // Using the flexible request method
        const response = await client.request(
            'GET',
            'https://api.github.com/user',
            headers,
            null // no body for GET request
        );
        
        console.log('Response status:', response.status);
        console.log('Response headers:', response.headers);
        // Note: This will fail with 401 unless you provide a valid token
        if (response.status === 401) {
            console.log('Expected 401 - no valid token provided');
        }
    } catch (error) {
        console.error('Request error:', error);
    }
    
    console.log('\n---\n');
    
    // Example 2: CRUD operations demonstration
    console.log('2. Full CRUD operations example...');
    
    const apiBase = 'https://jsonplaceholder.typicode.com';
    let createdId;
    
    // CREATE (POST)
    try {
        console.log('CREATE: Creating a new resource...');
        const newResource = {
            title: 'Advanced Example Post',
            body: 'Created with rust-fetch advanced features',
            userId: 1
        };
        
        const createResponse = await client.post_json(`${apiBase}/posts`, newResource);
        createdId = createResponse.body.id;
        console.log('Created resource with ID:', createdId);
    } catch (error) {
        console.error('CREATE error:', error);
    }
    
    // READ (GET)
    try {
        console.log('\nREAD: Fetching the resource...');
        const readResponse = await client.get(`${apiBase}/posts/1`);
        console.log('Resource title:', readResponse.body.title);
    } catch (error) {
        console.error('READ error:', error);
    }
    
    // UPDATE (PUT)
    try {
        console.log('\nUPDATE: Updating the entire resource...');
        const updatedResource = {
            id: 1,
            title: 'Completely Updated Title',
            body: 'This resource has been completely updated',
            userId: 1
        };
        
        const updateResponse = await client.put_json(`${apiBase}/posts/1`, updatedResource);
        console.log('Updated resource:', updateResponse.body);
    } catch (error) {
        console.error('UPDATE error:', error);
    }
    
    // PARTIAL UPDATE (PATCH)
    try {
        console.log('\nPATCH: Partially updating the resource...');
        const partialUpdate = {
            title: 'Only the title is updated'
        };
        
        const patchResponse = await client.patch_json(`${apiBase}/posts/1`, partialUpdate);
        console.log('Patched resource:', patchResponse.body);
    } catch (error) {
        console.error('PATCH error:', error);
    }
    
    // DELETE
    try {
        console.log('\nDELETE: Removing the resource...');
        const deleteResponse = await client.delete(`${apiBase}/posts/1`);
        console.log('Delete response status:', deleteResponse.status);
    } catch (error) {
        console.error('DELETE error:', error);
    }
    
    console.log('\n---\n');
    
    // Example 3: HEAD request (checking resource without body)
    console.log('3. HEAD request example...');
    try {
        const headResponse = await client.head('https://httpbin.org/status/200');
        console.log('HEAD response status:', headResponse.status);
        console.log('Headers:', headResponse.headers);
        console.log('Body (should be empty):', headResponse.body);
    } catch (error) {
        console.error('HEAD error:', error);
    }
    
    console.log('\n---\n');
    
    // Example 4: Working with different content types
    console.log('4. Different content types example...');
    
    // JSON request/response (already demonstrated above)
    
    // Text response
    try {
        console.log('\nFetching HTML content...');
        const htmlHeaders = {
            'Accept': 'text/html'
        };
        
        const htmlResponse = await client.request(
            'GET',
            'https://httpbin.org/html',
            htmlHeaders,
            null
        );
        
        console.log('HTML response (first 200 chars):', htmlResponse.body.substring(0, 200) + '...');
    } catch (error) {
        console.error('HTML fetch error:', error);
    }
    
    // Form data submission
    try {
        console.log('\nSubmitting form data...');
        const formData = {
            'field1': 'value1',
            'field2': 'value2',
            'email': 'test@example.com'
        };
        
        const formHeaders = {
            'Content-Type': 'application/x-www-form-urlencoded'
        };
        
        // Convert object to URL-encoded string
        const formBody = new URLSearchParams(formData).toString();
        
        const formResponse = await client.request(
            'POST',
            'https://httpbin.org/post',
            formHeaders,
            formBody
        );
        
        console.log('Form submission response:', formResponse.body);
    } catch (error) {
        console.error('Form submission error:', error);
    }
    
    console.log('\n---\n');
    
    // Example 5: Error scenarios
    console.log('5. Handling different error scenarios...');
    
    // Network error
    try {
        await client.get('https://this-domain-definitely-does-not-exist-12345.com');
    } catch (error) {
        console.log('Network error caught:');
        console.log('  Kind:', error.kind);
        console.log('  Message:', error.message);
    }
    
    // HTTP error (404)
    try {
        await client.get('https://httpbin.org/status/404');
    } catch (error) {
        console.log('\nHTTP 404 error caught:');
        console.log('  Kind:', error.kind);
        console.log('  Status:', error.status);
        console.log('  Message:', error.message);
    }
    
    // Timeout simulation (using httpbin delay endpoint)
    console.log('\nNote: Timeout handling depends on client configuration');
}

// Run the example
main().catch(console.error);
