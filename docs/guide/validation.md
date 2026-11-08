# Validating responses with Zod and other schemas

An API can return something other than what its documentation says. The `schema` option checks the body of a response against a schema before your code sees it, and types the result: `response.body` is the schema's output, not `any`.

It works with any library that implements [Standard Schema](https://standardschema.dev), which includes Zod, Valibot and ArkType. rust-fetch depends on none of them: install the one you use. The tests of this repository run the examples below with Zod 4 and Valibot 1.

## Zod

```ts
import { WasmClient } from 'rust-fetch';
import { z } from 'zod';

const client = new WasmClient({ baseUrl: 'https://api.example.com/v1' });

const User = z.object({ id: z.number(), name: z.string() });

const response = await client.get('/users/42', { schema: User });
response.body.id;   // number
response.body.name; // string
```

The type comes from the schema, so there is no cast and no second definition to keep in step. Keys the schema does not list are removed by Zod's default `object`, so the body is exactly what the schema describes.

## Valibot

```ts
import * as v from 'valibot';

const User = v.object({ id: v.number(), name: v.string() });
const { body } = await client.get('/users/42', { schema: User });
```

## ArkType and others

Anything with a `~standard` property works the same way, including ArkType. If a library is not listed here, check that it implements Standard Schema.

## When the body does not match

The request rejects with a `ValidationError`. It carries the `issues` the schema reported, plus the `status`, `method` and `url` of the response.

```ts
import { isValidationError } from 'rust-fetch';

try {
  await client.get('/users/42', { schema: User });
} catch (error) {
  if (isValidationError(error)) {
    for (const issue of error.issues) console.error(issue.message, issue.path);
    // error.status is the response status (200 for a body that parsed but did not match)
  } else {
    throw error;
  }
}
```

- It is **not retried**: the server answered correctly, its content was wrong, and asking again would give the same body.
- `error.message` only counts the issues (`Response validation failed: 2 issues`). Validators such as Valibot quote the received value in their messages, and error messages end up in logs; read the values from `issues` when you need them.

## Transforms and async validators

The body becomes whatever the schema returns, so transforms and async validators work.

```ts
const UserName = z.object({ id: z.number() }).transform((user) => `user-${user.id}`);
const { body } = await client.get('/users/42', { schema: UserName }); // string
```

## Which methods

Every method that takes request options: `get`, `post`, `put`, `patch`, `delete`, `head`, `post_json`, `put_json`, `patch_json`, `request` and `fetch`. A `head` response has no body, so a schema that needs one fails with a `ValidationError`.

`schema` cannot be combined with `responseType: 'stream'` or `'ndjson'`, which have no single body to validate; that is an `InvalidInputError`. To validate each line of an NDJSON stream, parse the line yourself and run it through your schema.

## If you switch on `error.kind`

`ValidationError` is a `kind` of its own, and it only appears when you pass `schema`. If you handle errors in a `switch` over `error.kind` with an exhaustiveness check, add a case for it. See [Errors](/guide/errors).

The types (`StandardSchema`, `InferSchemaOutput`, `RustFetchValidationError`) are in the [API reference](/api/).
