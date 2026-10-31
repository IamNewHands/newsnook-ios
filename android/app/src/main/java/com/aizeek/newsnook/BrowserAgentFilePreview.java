package com.aizeek.newsnook;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.Color;
import android.util.Base64;
import java.io.File;
import java.io.IOException;
import java.io.OutputStream;
import org.json.JSONObject;

/** Bounded raster decoding/encoding. PDF parsing belongs exclusively to BrowserAgentPdfService. */
final class BrowserAgentFilePreview {
    static final int MAX_INPUT_BYTES = 32 * 1024 * 1024;
    static final int MAX_EDGE = 1600;
    static final int MAX_PIXELS = 1_920_000;
    static final int MAX_JPEG_BYTES = 1024 * 1024;
    private static final long MAX_SOURCE_PIXELS = 100_000_000L;
    private static final int MAX_SOURCE_EDGE = 32768;

    interface Check { void check() throws IOException; }

    static final class PreviewFailure extends IOException {
        PreviewFailure(String message) { super(message); }
        PreviewFailure(String message, Throwable error) { super(message, error); }
    }

    static final class EncodedImage {
        final byte[] bytes;
        final int size, width, height;
        EncodedImage(byte[] bytes, int size, int width, int height) {
            this.bytes = bytes; this.size = size; this.width = width; this.height = height;
        }
        JSONObject toJson() {
            JSONObject result = new JSONObject();
            put(result, "image", Base64.encodeToString(bytes, 0, size, Base64.NO_WRAP));
            put(result, "width", width); put(result, "height", height); put(result, "mime", "image/jpeg");
            return result;
        }
    }

    private BrowserAgentFilePreview() {}

    static JSONObject renderImage(File source, Check check) throws IOException {
        check.check();
        BitmapFactory.Options bounds = new BitmapFactory.Options();
        bounds.inJustDecodeBounds = true;
        BitmapFactory.decodeFile(source.getAbsolutePath(), bounds);
        check.check();
        int width = bounds.outWidth, height = bounds.outHeight;
        if (width <= 0 || height <= 0) throw new PreviewFailure("系统不支持该图片格式，或图片已损坏");
        if (width > MAX_SOURCE_EDGE || height > MAX_SOURCE_EDGE || (long) width * height > MAX_SOURCE_PIXELS)
            throw new PreviewFailure("图片原始像素过多，请先缩小图片");
        int sample = 1;
        while (ceilDivide(width, sample) > MAX_EDGE || ceilDivide(height, sample) > MAX_EDGE
                || (long) ceilDivide(width, sample) * ceilDivide(height, sample) > MAX_PIXELS) sample *= 2;
        BitmapFactory.Options options = new BitmapFactory.Options();
        options.inSampleSize = sample;
        options.inScaled = false;
        options.inPreferredConfig = Bitmap.Config.ARGB_8888;
        Bitmap decoded = BitmapFactory.decodeFile(source.getAbsolutePath(), options);
        if (decoded == null) throw new PreviewFailure("图片无法解码，请转换为 PNG 或 JPEG 后重试");
        Bitmap flattened = null;
        try {
            check.check();
            validateBitmap(decoded);
            Bitmap image = decoded;
            if (decoded.hasAlpha()) {
                flattened = Bitmap.createBitmap(decoded.getWidth(), decoded.getHeight(), Bitmap.Config.ARGB_8888);
                flattened.eraseColor(Color.WHITE);
                new Canvas(flattened).drawBitmap(decoded, 0, 0, null);
                image = flattened;
            }
            return encode(image, check).toJson();
        } finally {
            if (flattened != null) flattened.recycle();
            decoded.recycle();
        }
    }

    static void validateBitmap(Bitmap bitmap) throws IOException {
        if (bitmap.getWidth() > MAX_EDGE || bitmap.getHeight() > MAX_EDGE
                || (long) bitmap.getWidth() * bitmap.getHeight() > MAX_PIXELS
                || bitmap.getAllocationByteCount() > (long) MAX_PIXELS * 4)
            throw new PreviewFailure("图片解码超过预览像素上限，请先缩小图片");
    }

    static EncodedImage encode(Bitmap bitmap, Check check) throws IOException {
        BoundedOutput output = new BoundedOutput();
        for (int quality : new int[] {85, 70, 55, 40}) {
            check.check(); output.reset();
            boolean complete = bitmap.compress(Bitmap.CompressFormat.JPEG, quality, output);
            check.check();
            if (complete && !output.overflow && output.count > 0) {
                return new EncodedImage(output.bytes, output.count, bitmap.getWidth(), bitmap.getHeight());
            }
            if (!output.overflow) throw new PreviewFailure("无法生成文件图片预览");
        }
        throw new PreviewFailure("图片预览超过 1 MB，请先缩小图片");
    }

    /** Overflow is normal quality-selection control flow; do not make libjpeg report an I/O failure. */
    private static final class BoundedOutput extends OutputStream {
        final byte[] bytes = new byte[MAX_JPEG_BYTES];
        int count;
        boolean overflow;
        void reset() { count = 0; overflow = false; }
        @Override public void write(int value) {
            if (overflow) return;
            if (count == bytes.length) { overflow = true; return; }
            bytes[count++] = (byte) value;
        }
        @Override public void write(byte[] source, int offset, int length) {
            if (length < 0 || offset < 0 || length > source.length - offset) throw new IndexOutOfBoundsException();
            if (overflow) return;
            if (length > bytes.length - count) { overflow = true; return; }
            System.arraycopy(source, offset, bytes, count, length); count += length;
        }
    }

    private static int ceilDivide(int value, int divisor) { return (value + divisor - 1) / divisor; }
    private static void put(JSONObject value, String key, Object item) {
        try { value.put(key, item); } catch (org.json.JSONException ignored) {}
    }
}
