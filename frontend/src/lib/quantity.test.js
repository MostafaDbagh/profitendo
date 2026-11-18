import {formatQuantity} from './quantity';
test.each([['5.0000','5'],['0.00','0'],['2.5000','2.5'],['0.0001','0.0001'],['-1.2500','-1.25'],['99999999999999.9999','99999999999999.9999'],['10','10']])('formats %s without losing precision', (value,expected)=>expect(formatQuantity(value)).toBe(expected));
