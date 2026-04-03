import React from "react";
import { SectionList, StyleSheet, Switch, TextInput, View } from "react-native";
import TextUi from "../components/common/TextUi";
import {
  setDisableResume,
  setForceScanningLegacyDfu,
  setNumOfPackets,
  setPrnEnabled,
} from "../features/dfu/dfuSlice";
import { useAppDispatch, useAppSelector } from "../store";
import { Colors } from "../theme";
import { px } from "../utils/setSize";

type SwitchCell = {
  type: "switch";
  label: string;
  value: boolean;
  onChange: (val: boolean) => void;
  disabled?: boolean;
};

type InputCell = {
  type: "input";
  label: string;
  value: string;
  onChange: (val: string) => void;
  disabled?: boolean;
};

type CellItem = SwitchCell | InputCell;

type SectionType = {
  title: string;
  data: CellItem[];
};

const DFUSettingsScreen = () => {
  const { prnEnabled, numOfPackets, disableResume, forceScanningLegacyDfu } =
    useAppSelector((state) => state.dfu);
  const dispatch = useAppDispatch();

  const DATA: SectionType[] = [
    {
      title: "General",
      data: [
        {
          type: "switch",
          label: "Packet receipt notification",
          value: prnEnabled,
          onChange: (val) => dispatch(setPrnEnabled(val)),
          disabled: true,
        },
        {
          type: "input",
          label: "Number of Packets",
          value: `${numOfPackets}`,
          onChange: (val) => dispatch(setNumOfPackets(Number(val))),
          disabled: true,
        },
      ],
    },
    {
      title: "Secure Dfu Option",
      data: [
        {
          type: "switch",
          label: "Disable Resume",
          value: disableResume,
          onChange: (val) => dispatch(setDisableResume(val)),
          disabled: true,
        },
      ],
    },
    {
      title: "Legacy DFU",
      data: [
        {
          type: "switch",
          label: "Force Scanning",
          value: forceScanningLegacyDfu,
          onChange: (val) => dispatch(setForceScanningLegacyDfu(val)),
          disabled: true,
        },
      ],
    },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.dfuSettingsNotif}>
        <TextUi tag="h4" weight="medium">
          Note: We have optimized the DFU Settings for the seamless uploading
          experience.
        </TextUi>
      </View>
      <SectionList
        sections={DATA}
        keyExtractor={(item, index) => item.label + index}
        renderItem={({ item, index, section }) => {
          const isFirst = index === 0;
          const isLast = index === section.data.length - 1;

          return (
            <View
              style={[
                styles.cell,
                isFirst && styles.firstCell,
                isLast && styles.lastCell,
              ]}
            >
              <TextUi tag="h4" style={styles.cellLabel}>
                {item.label}
              </TextUi>
              {item.type === "switch" ? (
                <Switch
                  value={item.value}
                  onValueChange={item.onChange}
                  disabled={item.disabled}
                  trackColor={{
                    false: Colors.warmGray,
                    true: Colors.secondary,
                  }}
                />
              ) : (
                <TextInput
                  style={styles.input}
                  keyboardType="numeric"
                  value={item.value}
                  onChangeText={item.onChange}
                  placeholder="Enter Packet Number"
                />
              )}
            </View>
          );
        }}
        renderSectionHeader={({ section: { title } }) => (
          <TextUi tag="h5" style={styles.sectionTitle}>
            {title}
          </TextUi>
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        stickySectionHeadersEnabled={false} // grouped style usually not sticky
        contentContainerStyle={{ paddingVertical: 20 }}
        renderSectionFooter={() => <View style={{ height: 28 }} />}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.lightGray,
    padding: px(16),
  },
  dfuSettingsNotif: {
    padding: px(20),
    marginVertical: px(12),
    borderRadius: px(12),
    shadowColor: "#000",
    shadowOpacity: 0.1,
    shadowOffset: { width: 1, height: 2 },
    shadowRadius: px(4),
    elevation: px(2), // for Android
    backgroundColor: Colors.warmGray,
  },
  sectionTitle: {
    color: Colors.disabled,
    marginLeft: px(16),
    marginBottom: px(16),
    textTransform: "uppercase",
  },
  cell: {
    backgroundColor: Colors.white,
    paddingHorizontal: px(20),
    paddingVertical: px(16),
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  firstCell: {
    borderTopLeftRadius: px(16),
    borderTopRightRadius: px(16),
  },
  lastCell: {
    borderBottomLeftRadius: px(16),
    borderBottomRightRadius: px(16),
    borderBottomWidth: 0, // remove last separator
  },
  cellLabel: {
    flexGrow: 1,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: Colors.disabled,
    marginHorizontal: px(16),
  },
  input: {
    paddingVertical: px(4),
    minWidth: px(120),
    textAlign: "right",
  },
});

export default DFUSettingsScreen;
