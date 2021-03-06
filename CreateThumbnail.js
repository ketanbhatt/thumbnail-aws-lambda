// dependencies
var async = require('async');
var AWS = require('aws-sdk');
var gm = require('gm')
            .subClass({ imageMagick: true }); // Enable ImageMagick integration.
var util = require('util');

// constants
var MAX_WIDTH  = 350;
var MAX_HEIGHT = 300;

// get reference to S3 client 
var s3 = new AWS.S3();
 
exports.handler = function(event, context) {
	// Read options from the event.
	console.log("Reading options from event:\n", util.inspect(event, {depth: 5}));
	var srcBucket = event.Records[0].s3.bucket.name;
	// Object key may have spaces or unicode non-ASCII characters.
    var srcKey    =
    decodeURIComponent(event.Records[0].s3.object.key.replace(/\+/g, " ")); 
    	var srcName = srcKey.match(/([^.]+)/); 
	var dstBucket = srcBucket + "resized";
	var dstKey    = "resized-" + srcName[0] + ".png";

	// Sanity check: validate that source and destination are different buckets.
	if (srcBucket == dstBucket) {
		console.error("Destination bucket must not match source bucket.");
		return;
	}

	// Infer the image type.
	var typeMatch = srcKey.match(/\.([^.]*)$/);
	if (!typeMatch) {
		console.error('unable to infer image type for key ' + srcKey);
		return;
	}
	var fileType = typeMatch[1];
	fileType = fileType.toLowerCase();
	if (fileType != "jpg" && fileType != "png" && fileType != "jpeg" && fileType != "pdf") {
		console.log('skipping Unsupported File format ' + srcKey);
		return;
	}

	// Download the image from S3, transform, and upload to a different S3 bucket.
	async.waterfall([
		function download(next) {
			// Download the image from S3 into a buffer.
			s3.getObject({
					Bucket: srcBucket,
					Key: srcKey
				},
				next);
			},
		function tranform(response, next) {
			gm(response.Body).size(function(err, size) {
				// Infer the scaling factor to avoid stretching the image unnaturally.
				var scalingFactor = Math.min(
					MAX_WIDTH / size.width,
					MAX_HEIGHT / size.height
				);

				if(fileType == "pdf") {
					var width  = size.width;
					var height = size.height;
				} else {
					var width  = scalingFactor * size.width;
					var height = scalingFactor * size.height;
				}

				// Transform the image buffer in memory.
				this.resize(width, height)
					.toBuffer("png", function(err, buffer) {
						if (err) {
							next(err);
						} else {
							next(null, response.ContentType, buffer);
						}
					});
			});
		},
		function upload(contentType, data, next) {
			// Stream the transformed image to a different S3 bucket.
			s3.putObject({
					Bucket: dstBucket,
					Key: dstKey,
					Body: data,
					ContentType: 'png'
				},
				next);
			}
		], function (err) {
			if (err) {
				console.error(
					'Unable to resize ' + srcBucket + '/' + srcKey +
					' and upload to ' + dstBucket + '/' + dstKey +
					' due to an error: ' + err
				);
			} else {
				console.log(
					'Successfully resized ' + srcBucket + '/' + srcKey +
					' and uploaded to ' + dstBucket + '/' + dstKey
				);
			}

			context.done();
		}
	);
};
