import { fail, redirect } from '@sveltejs/kit';
import { createCollection, getCollections } from '$lib/db.js';

export async function load() {
  return { collections: await getCollections() };
}

export const actions = {
  create: async ({ request }) => {
    const form = await request.formData();
    const name = String(form.get('name') || '').trim();
    if (!name) return fail(400, { error: 'Collection name is required.' });
    const collection = await createCollection(name);
    throw redirect(303, `/collections/${collection.id}`);
  }
};
