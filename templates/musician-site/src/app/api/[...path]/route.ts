/**
 * Every `/api` URL: the API router dispatches on path and method, with a
 * 404 for an unknown path and a 405 for a method the path doesn't serve.
 */
export { DELETE, GET, PATCH, POST, PUT } from "../../../api/router.js";
