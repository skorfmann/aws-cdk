import assets = require('@aws-cdk/assets');
import s3 = require('@aws-cdk/aws-s3');
import fs = require('fs');
import { Function as Func } from './lambda';
import { CfnFunction } from './lambda.generated';

export abstract class Code {
  /**
   * @returns `LambdaS3Code` associated with the specified S3 object.
   * @param bucket The S3 bucket
   * @param key The object key
   * @param objectVersion Optional S3 object version
   */
  public static bucket(bucket: s3.IBucket, key: string, objectVersion?: string) {
    return new S3Code(bucket, key, objectVersion);
  }

  /**
   * @returns `LambdaInlineCode` with inline code.
   * @param code The actual handler code (limited to 4KiB)
   */
  public static inline(code: string) {
    return new InlineCode(code);
  }

  /**
   * Loads the function code from a local disk asset.
   * @param path Either a directory with the Lambda code bundle or a .zip file
   */
  public static asset(path: string) {
    return new AssetCode(path);
  }

  /**
   * @returns Zip archives the contents of a directory on disk and uses this
   * as the lambda handler's code.
   * @param directoryToZip The directory to zip
   * @deprecated use `lambda.Code.asset(path)` (no need to specify if it's a file or a directory)
   */
  public static directory(directoryToZip: string) {
    return new AssetCode(directoryToZip, assets.AssetPackaging.ZipDirectory);
  }

  /**
   * @returns Uses a file on disk as a lambda handler's code.
   * @param filePath The file path
   * @deprecated use `lambda.Code.asset(path)` (no need to specify if it's a file or a directory)
   */
  public static file(filePath: string) {
    return new AssetCode(filePath, assets.AssetPackaging.File);
  }

  /**
   * Called during stack synthesis to render the CodePropery for the
   * Lambda function.
   */
  public abstract toJSON(resource: CfnFunction): CfnFunction.CodeProperty;

  /**
   * Called when the lambda is initialized to allow this object to
   * bind to the stack, add resources and have fun.
   */
  public bind(_lambda: Func) {
    return;
  }
}

/**
 * Lambda code from an S3 archive.
 */
export class S3Code extends Code {
  private bucketName: string;

  constructor(bucket: s3.IBucket, private key: string, private objectVersion?: string) {
    super();

    if (!bucket.bucketName) {
      throw new Error('bucketName is undefined for the provided bucket');
    }

    this.bucketName = bucket.bucketName;
  }

  public toJSON(_: CfnFunction): CfnFunction.CodeProperty {
    return {
      s3Bucket: this.bucketName,
      s3Key: this.key,
      s3ObjectVersion: this.objectVersion
    };
  }
}

/**
 * Lambda code from an inline string (limited to 4KiB).
 */
export class InlineCode extends Code {
  constructor(private code: string) {
    super();

    if (code.length > 4096) {
      throw new Error("Lambda source is too large, must be <= 4096 but is " + code.length);
    }
  }

  public bind(lambda: Func) {
    if (!lambda.runtime.supportsInlineCode) {
      throw new Error(`Inline source not allowed for ${lambda.runtime.name}`);
    }
  }

  public toJSON(_: CfnFunction): CfnFunction.CodeProperty {
    return {
      zipFile: this.code
    };
  }
}

/**
 * Lambda code from a local directory.
 */
export class AssetCode extends Code {
  /**
   * The asset packaging.
   */
  public readonly packaging: assets.AssetPackaging;

  private asset?: assets.Asset;

  /**
   * @param path The path to the asset file or directory.
   * @param packaging The asset packaging format (optional, determined automatically)
   */
  constructor(public readonly path: string, packaging?: assets.AssetPackaging) {
    super();

    if (packaging !== undefined) {
      this.packaging = packaging;
    } else {
      this.packaging = fs.lstatSync(path).isDirectory()
      ? assets.AssetPackaging.ZipDirectory
      : assets.AssetPackaging.File;
    }
  }

  public bind(lambda: Func) {
    // If the same AssetCode is used multiple times, retain only the first instantiation.
    if (!this.asset) {
      this.asset = new assets.Asset(lambda, 'Code', {
        path: this.path,
        packaging: this.packaging
      });
    }

    if (!this.asset.isZipArchive) {
      throw new Error(`Asset must be a .zip file or a directory (${this.path})`);
    }
  }

  public toJSON(resource: CfnFunction): CfnFunction.CodeProperty {
    // https://github.com/awslabs/aws-cdk/issues/1432
    this.asset!.addResourceMetadata(resource, 'Code');

    return  {
      s3Bucket: this.asset!.s3BucketName,
      s3Key: this.asset!.s3ObjectKey
    };
  }
}
