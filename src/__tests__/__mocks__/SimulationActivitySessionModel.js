'use strict';
module.exports = {
  findById:                  jest.fn(),
  create:                    jest.fn(),
  updateHeartbeat:           jest.fn(),
  end:                       jest.fn(),
  endStaleActive:            jest.fn(),
  listByUser:                jest.fn(),
  listByCourse:              jest.fn(),
  getCourseSummary:          jest.fn(),
  getLatestByLessonUser:     jest.fn(),
  markAbandonedByHeartbeat:  jest.fn(),
  markExpiredNoHeartbeat:    jest.fn(),
};
