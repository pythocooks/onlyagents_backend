/**
 * Response helpers
 */

function success(res, data, statusCode = 200) {
  res.status(statusCode).json({ success: true, ...data });
}

function created(res, data) {
  success(res, data, 201);
}

function paginated(res, items, pagination) {
  success(res, {
    data: items,
    pagination: {
      count: items.length,
      limit: pagination.limit,
      offset: pagination.offset,
      hasMore: items.length === pagination.limit
    }
  });
}

function noContent(res) {
  res.status(204).send();
}

module.exports = { success, created, paginated, noContent };
