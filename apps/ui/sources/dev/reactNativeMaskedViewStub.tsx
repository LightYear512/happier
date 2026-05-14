import * as React from 'react';

type MaskedViewProps = Readonly<{
    children?: React.ReactNode;
    maskElement?: React.ReactNode;
}> & Record<string, unknown>;

export default function MaskedView(props: MaskedViewProps): React.ReactElement {
    const { children, maskElement: _maskElement, ...rest } = props;
    return React.createElement('MaskedView', rest, children);
}
