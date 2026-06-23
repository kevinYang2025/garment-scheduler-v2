import { DefaultNamingStrategy, NamingStrategyInterface } from 'typeorm';
import { snakeCase } from 'typeorm/util/StringUtils';

/**
 * TypeORM 命名策略 — 强制 snake_case 列名
 *
 * 默认 TypeORM 直接用 JS 字段名作列名(camelCase),
 * 但我们的数据库字段是 snake_case(style_no/plan_qty/user_id 等),
 * 所以必须明确告诉 TypeORM 转换。
 *
 * 与 garment-server/db.js schema 严格一致。
 *
 * 应用范围:所有 Column / JoinColumn / Index 不显式 name 时自动转换
 */

export class SnakeCaseNamingStrategy extends DefaultNamingStrategy implements NamingStrategyInterface {
  columnName(propertyName: string, customName: string, embeddedPrefixes: string[]): string {
    // B1-8 修复:?? 替代 ||(customName 空字符串仍用 snakeCase,|| 也会,但 ?? 语义更精确)
    return customName ?? snakeCase(embeddedPrefixes.join('_') + propertyName);
  }

  joinColumnName(relationName: string, referencedColumnName: string): string {
    return snakeCase(relationName + '_' + referencedColumnName);
  }

  joinTableName(firstTableName: string, secondTableName: string, firstPropertyName: string, secondPropertyName: string): string {
    return snakeCase(firstTableName + '_' + secondTableName);
  }

  joinTableColumnName(tableName: string, propertyName: string, columnName?: string): string {
    return snakeCase(tableName + '_' + (columnName ?? propertyName));
  }

  classTableInheritanceParentColumnName(parentTableName: string, parentTableIdPropertyName: string): string {
    return snakeCase(parentTableName + '_' + parentTableIdPropertyName);
  }

  primaryKeyName(tableOrName: string, columnNames: string[]): string {
    return 'PK_' + snakeCase(tableOrName + '_' + columnNames.join('_'));
  }

  uniqueConstraintName(tableOrName: string, columnNames: string[]): string {
    return 'UQ_' + snakeCase(tableOrName + '_' + columnNames.join('_'));
  }

  indexName(tableOrName: string, columnNames: string[]): string {
    return 'IDX_' + snakeCase(tableOrName + '_' + columnNames.join('_'));
  }

  relationConstraintName(tableOrName: string, columnNames: string[]): string {
    return 'FK_' + snakeCase(tableOrName + '_' + columnNames.join('_'));
  }

  defaultConstraintName(tableOrName: string, columnName: string): string {
    return 'DF_' + snakeCase(tableOrName + '_' + columnName);
  }

  checkConstraintName(tableOrName: string, expression: string): string {
    return 'CHK_' + snakeCase(tableOrName + '_' + expression);
  }

  exclusionConstraintName(
    tableOrName: string | { name?: string },
    expression: string,
  ): string {
    const name = typeof tableOrName === 'string' ? tableOrName : (tableOrName.name ?? '');
    return 'XCL_' + snakeCase(name + '_' + expression);
  }
}