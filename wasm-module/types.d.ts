// Type definitions for rust-fetch
// Project: https://github.com/asemqaffaf/rust-fetch
// Definitions by: Asem Qaffaf <asem@qaffaf.com>

export interface HttpResponse {
  /**
   * HTTP status code (e.g., 200, 404, 500)
   */
  status: number;
  
  /**
   * HTTP status text (e.g., "OK", "Not Found", "Internal Server Error")
   */
  statusText: string;
  
  /**
   * Response headers as a key-value object
   */
  headers: Record<string, string>;
  
  /**
   * Response body - can be JSON object, string, or Uint8Array depending on content type
   */
  body: any;
  
  /**
   * Final URL after any redirects
   */
  url: string;
}

export interface RequestOptions {
  /**
   * HTTP method (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS)
   */
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD' | 'OPTIONS';
  
  /**
   * Request headers as key-value pairs
   */
  headers?: Record<string, string>;
  
  /**
   * Request body - can be string, object (for JSON), or FormData
   */
  body?: string | object | FormData;
  
  /**
   * Request timeout in milliseconds
   */
  timeout?: number;
  
  /**
   * Number of retry attempts for failed requests
   */
  retries?: number;
  
  /**
   * Whether to follow redirects
   */
  followRedirects?: boolean;
}

export interface HttpError {
  /**
   * Error type/kind
   */
  kind: 'NetworkError' | 'HttpError' | 'ParseError' | 'TimeoutError' | 'InvalidInputError' | 'JsInteropError' | 'CancelledError';
  
  /**
   * Human-readable error message
   */
  message: string;
  
  /**
   * HTTP status code (for HttpError)
   */
  status?: number;
  
  /**
   * HTTP status text (for HttpError)
   */
  statusText?: string;
  
  /**
   * Response body (for HttpError)
   */
  body?: string;
  
  /**
   * Timeout duration in milliseconds (for TimeoutError)
   */
  timeoutMs?: number;
  
  /**
   * Parameter name (for InvalidInputError)
   */
  parameter?: string;
}

/**
 * Configuration options for creating a client
 */
export interface ClientConfig {
  /**
   * Base URL for all requests
   */
  baseUrl?: string;
  
  /**
   * Default headers to include with every request
   */
  defaultHeaders?: Record<string, string>;
  
  /**
   * Default timeout for requests in seconds
   */
  timeout?: number;
  
  /**
   * Enable automatic retries with exponential backoff
   */
  enableRetries?: boolean;
  
  /**
   * Maximum number of retry attempts
   */
  maxRetries?: number;
}

/**
 * WebAssembly HTTP Client
 */
export declare class WasmClient {
  /**
   * Create a new HTTP client
   */
  constructor();
  
  /**
   * Make a GET request
   * @param url - The URL to request
   * @returns Promise resolving to the response
   */
  get(url: string): Promise<HttpResponse>;
  
  /**
   * Make a POST request with JSON body
   * @param url - The URL to request
   * @param body - The JSON body to send
   * @returns Promise resolving to the response
   */
  post_json(url: string, body: any): Promise<HttpResponse>;
  
  /**
   * Make a PUT request with JSON body
   * @param url - The URL to request
   * @param body - The JSON body to send
   * @returns Promise resolving to the response
   */
  put_json(url: string, body: any): Promise<HttpResponse>;
  
  /**
   * Make a DELETE request
   * @param url - The URL to request
   * @returns Promise resolving to the response
   */
  delete(url: string): Promise<HttpResponse>;
  
  /**
   * Make a PATCH request with JSON body
   * @param url - The URL to request
   * @param body - The JSON body to send
   * @returns Promise resolving to the response
   */
  patch_json(url: string, body: any): Promise<HttpResponse>;
  
  /**
   * Make a HEAD request
   * @param url - The URL to request
   * @returns Promise resolving to the response
   */
  head(url: string): Promise<HttpResponse>;
  
  /**
   * Make a custom request with full control
   * @param method - HTTP method
   * @param url - The URL to request
   * @param headers - Request headers (optional)
   * @param body - Request body (optional)
   * @returns Promise resolving to the response
   */
  request(method: string, url: string, headers?: Record<string, string>, body?: string | object): Promise<HttpResponse>;
}

/**
 * Simple fetch function for JSON data
 * @param url - The URL to fetch from
 * @returns Promise resolving to the parsed JSON data
 */
export declare function fetch_json(url: string): Promise<any>;

/**
 * Fetch JSON data and return as a Promise
 * @param url - The URL to fetch from
 * @returns Promise resolving to the parsed JSON data
 */
export declare function fetch_json_promise(url: string): Promise<any>;

/**
 * Simple fetch function for text/HTML data
 * @param url - The URL to fetch from
 * @returns Promise resolving to the text content
 */
export declare function fetch_text(url: string): Promise<string>;

/**
 * Advanced fetch function with full options
 * @param url - The URL to fetch from
 * @param method - HTTP method
 * @param headers - Request headers
 * @param body - Request body (optional)
 * @returns Promise resolving to the response
 */
export declare function fetch_with_options(
  url: string,
  method: string,
  headers: Record<string, string>,
  body?: string
): Promise<HttpResponse>;

/**
 * Create a configured HTTP client
 * @returns A new WasmClient instance
 */
export declare function create_client(): WasmClient;

// Re-export the initialization function
export { default as init } from './wasm_module';
